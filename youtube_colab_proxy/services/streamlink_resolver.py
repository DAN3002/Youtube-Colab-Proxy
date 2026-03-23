from typing import Dict, List, Optional, Tuple, Any
import time
import subprocess
import json
import re
from urllib.parse import urlparse, urljoin, quote

import streamlink
from streamlink.exceptions import PluginError, NoStreamsError

# Cache for stream information
STREAMLINK_CACHE: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SEC = 5 * 60  # 5 minutes cache for streamlink (shorter than YouTube)


def get_supported_sites() -> List[str]:
    """Get list of supported streaming sites."""
    try:
        return list(streamlink.plugin.api.pluginmatcher.PLUGINS.keys())
    except:
        # Fallback list of popular sites if API access fails
        return [
            'twitch', 'youtube', 'facebook', 'dailymotion', 'vimeo', 
            'instagram', 'twitter', 'tiktok', 'kick', 'afreecatv',
            'bilibili', 'crunchyroll', 'funimation', 'hulu', 'netflix'
        ]


def is_supported_url(url: str) -> bool:
    """Check if URL is supported by streamlink."""
    try:
        session = streamlink.Streamlink()
        return session.resolve_url_no_redirect(url) is not None
    except:
        # Fallback: check if domain matches known patterns
        parsed = urlparse(url)
        domain = parsed.netloc.lower()
        
        supported_domains = [
            'twitch.tv', 'youtube.com', 'youtu.be', 'facebook.com', 
            'dailymotion.com', 'vimeo.com', 'instagram.com', 'twitter.com',
            'tiktok.com', 'kick.com', 'afreecatv.com', 'bilibili.com'
        ]
        
        return any(domain.endswith(d) for d in supported_domains)


def get_stream_info(url: str) -> Dict[str, Any]:
    """Get stream information and metadata from URL."""
    now = time.time()
    cache_key = f"info:{url}"
    
    # Check cache
    cached = STREAMLINK_CACHE.get(cache_key)
    if cached and (now - float(cached.get("ts", 0))) < CACHE_TTL_SEC:
        return cached["data"]
    
    try:
        session = streamlink.Streamlink()
        
        # Get available streams
        streams = session.streams(url)
        if not streams:
            raise NoStreamsError("No streams found for this URL")
        
        # Get stream metadata if available
        plugin = session.resolve_url_no_redirect(url)
        title = None
        author = None
        
        try:
            # Try to get metadata from the plugin
            if hasattr(plugin, 'get_title'):
                title = plugin.get_title()
            if hasattr(plugin, 'get_author'):  
                author = plugin.get_author()
        except:
            pass
        
        # Organize stream qualities
        quality_order = ['best', '1080p60', '1080p', '720p60', '720p', '480p', '360p', '160p', 'worst']
        available_qualities = []
        
        for quality in quality_order:
            if quality in streams:
                stream_info = {
                    'quality': quality,
                    'available': True
                }
                available_qualities.append(stream_info)
        
        # Add any other qualities not in our predefined list
        for quality, stream in streams.items():
            if quality not in quality_order:
                stream_info = {
                    'quality': quality,
                    'available': True
                }
                available_qualities.append(stream_info)
        
        result = {
            'url': url,
            'title': title or 'Unknown Title',
            'author': author or 'Unknown Author',
            'available_qualities': available_qualities,
            'supported': True
        }
        
        # Cache the result
        STREAMLINK_CACHE[cache_key] = {"data": result, "ts": now}
        return result
        
    except Exception as e:
        error_result = {
            'url': url,
            'title': 'Error',
            'author': 'Unknown',
            'available_qualities': [],
            'best_stream': None,
            'supported': False,
            'error': str(e)
        }
        return error_result


def resolve_stream_url(url: str, quality: str = 'best') -> Tuple[str, Dict[str, str]]:
    """Resolve streaming URL to direct media URL with headers."""
    now = time.time()
    cache_key = f"stream:{url}:{quality}"
    
    # Check cache
    cached = STREAMLINK_CACHE.get(cache_key)
    if cached and (now - float(cached.get("ts", 0))) < CACHE_TTL_SEC:
        return cached["direct_url"], cached.get("headers", {})
    
    try:
        session = streamlink.Streamlink()
        streams = session.streams(url)
        
        if not streams:
            raise NoStreamsError("No streams found for this URL")
        
        # Get the requested quality or fall back to best
        stream = streams.get(quality) or streams.get('best')
        if not stream:
            # Try to find any available stream
            stream = next(iter(streams.values()))
        
        if not stream:
            raise RuntimeError("No suitable stream found")
        
        # Store the stream object for later use - we'll handle streaming in the Flask route
        # Don't try to extract URL here as it's complex for HLS streams
        direct_url = f"streamlink://{url}#{quality}"
        
        # Prepare headers - streamlink handles most authentication internally
        headers = {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
            'Accept': 'application/vnd.apple.mpegurl, video/mp4, video/webm, */*',
        }
        
        # Cache the result
        STREAMLINK_CACHE[cache_key] = {
            "direct_url": direct_url, 
            "headers": headers, 
            "ts": now
        }
        
        return direct_url, headers
        
    except Exception as e:
        raise RuntimeError(f"Failed to resolve stream: {e}")


def get_stream_thumbnail(url: str) -> Optional[str]:
    """Try to extract thumbnail URL from stream."""
    try:
        session = streamlink.Streamlink()
        plugin = session.resolve_url_no_redirect(url)
        
        if hasattr(plugin, 'get_thumbnail'):
            return plugin.get_thumbnail()
    except:
        pass
    
    return None 


def _get_session() -> streamlink.Streamlink:
	return streamlink.Streamlink()


def get_best_hls_url(source_url: str) -> str:
	"""Return best playable URL (prefer HLS master m3u8) for given URL."""
	session = _get_session()
	streams = session.streams(source_url)
	if not streams:
		raise NoStreamsError("No streams found")
	# Prefer 'best' first
	best = streams.get('best')
	if best is None:
		# pick arbitrary
		best = next(iter(streams.values()))
	# Many plugins return HLSStream; try to get its URL
	if hasattr(best, 'url') and best.url:
		return best.url
	# Try opening briefly to derive url
	fd = best.open()
	try:
		u = getattr(fd, 'url', None)
		if not u:
			u = str(best)
		return u
	finally:
		fd.close()


def rewrite_hls_manifest(manifest_text: str, manifest_url: str, proxy_base: str) -> str:
	"""Rewrite an HLS manifest so that segment URIs go through our proxy.
	- manifest_text: original m3u8 content
	- manifest_url: absolute URL the manifest was fetched from
	- proxy_base: like '/streamlink/segment?src=<encoded_master>'
	"""
	lines = manifest_text.splitlines()
	out_lines: List[str] = []
	for line in lines:
		if line and line.startswith('#'):
			# Rewrite URI attributes inside tag lines (e.g., EXT-X-KEY, EXT-X-MAP, EXT-X-MEDIA)
			def _repl(m):
				orig = m.group(1)
				abs_url = urljoin(manifest_url, orig)
				return f'URI="{proxy_base}&u={quote(abs_url, safe="")}"'
			line = re.sub(r'URI="([^"]+)"', _repl, line)
			out_lines.append(line)
			continue
		if not line or line.startswith('#'):
			out_lines.append(line)
			continue
		# line is a URI (segment or variant playlist)
		abs_url = urljoin(manifest_url, line)
		# Route via proxy
		proxied = f"{proxy_base}&u={quote(abs_url, safe='')}"
		out_lines.append(proxied)
	return "\n".join(out_lines) + ("\n" if not manifest_text.endswith("\n") else "") 
