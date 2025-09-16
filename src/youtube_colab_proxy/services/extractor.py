from typing import Dict, Any, Optional, Tuple

import yt_dlp
from yt_dlp.utils import DownloadError


def _pick_progressive_mp4(info_dict: Dict[str, Any], max_height: int = 720) -> Optional[Dict[str, Any]]:
	"""Pick the best progressive MP4 <= max_height that has both audio and video."""
	formats = info_dict.get("formats") or []
	candidates = []
	for fmt in formats:
		if fmt.get("ext") == "mp4" and fmt.get("vcodec") != "none" and fmt.get("acodec") != "none":
			height = fmt.get("height") or 0
			if height <= max_height:
				candidates.append((height, fmt))
	if candidates:
		candidates.sort(key=lambda x: x[0], reverse=True)
		return candidates[0][1]
	return None


def extract_direct_media(youtube_url: str) -> Tuple[str, Dict[str, str]]:
	"""Return a tuple of (direct_media_url, http_headers) for the given YouTube URL.

	Tries to use yt_dlp's top-level URL when available, falling back to a progressive
	MP4 format (<=720p) with both audio and video if necessary.
	Raises RuntimeError if no suitable direct URL can be found.
	"""
	ydl_opts_strict = {
		"quiet": True,
		"nocheckcertificate": True,
		"format": "bestvideo[ext=mp4][height<=720][vcodec!=none]+bestaudio[acodec!=none]/best[ext=mp4][height<=720]",
		"noplaylist": True,
	}

	try:
		with yt_dlp.YoutubeDL(ydl_opts_strict) as ydl:
			info = ydl.extract_info(youtube_url, download=False)
	except DownloadError:
		# Relax constraints if the requested strict format isn't available
		ydl_opts_fallback = {
			"quiet": True,
			"nocheckcertificate": True,
			"noplaylist": True,
		}
		with yt_dlp.YoutubeDL(ydl_opts_fallback) as ydl:
			info = ydl.extract_info(youtube_url, download=False)

	direct_url = info.get("url")
	headers = info.get("http_headers") or {}

	if not direct_url:
		chosen_fmt = _pick_progressive_mp4(info)
		if chosen_fmt:
			direct_url = chosen_fmt.get("url")
			if chosen_fmt.get("http_headers"):
				headers.update(chosen_fmt["http_headers"]) 

	if not direct_url:
		raise RuntimeError(
			"No progressive MP4 <=720p found for direct streaming. Choose another video or download/merge locally."
		)

	return direct_url, headers 
