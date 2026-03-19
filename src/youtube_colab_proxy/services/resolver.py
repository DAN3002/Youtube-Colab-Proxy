from typing import Dict, Tuple, Optional, List, Any
import time

import yt_dlp
from yt_dlp.utils import DownloadError

from .extractor import _pick_progressive_mp4  # type: ignore

STREAM_CACHE: Dict[str, Dict[str, object]] = {}
CACHE_TTL_SEC = 20 * 60
COMMENTS_CACHE: Dict[str, Dict[str, object]] = {}
COMMENTS_CACHE_TTL_SEC = 10 * 60
VIDEO_INFO_CACHE: Dict[str, Dict[str, object]] = {}
VIDEO_INFO_CACHE_TTL_SEC = 10 * 60

_COOKIEFILE: Optional[str] = None
_COOKIES_STR: Optional[str] = None
# Preferred browser source for cookies when file/string not provided
_COOKIES_FROM_BROWSER: Optional[str] = None
_COOKIES_BROWSER_PROFILE: Optional[str] = None

def set_cookie_file(path: Optional[str]) -> None:
	global _COOKIEFILE
	_COOKIEFILE = path


def set_cookies_str(cookies: Optional[str]) -> None:
	global _COOKIES_STR
	_COOKIES_STR = cookies


def set_cookies_from_browser(browser: Optional[str], profile: Optional[str]) -> None:
	"""Set browser and profile to auto-extract cookies via yt_dlp.
	If cookie file or string are provided, they take precedence.
	"""
	global _COOKIES_FROM_BROWSER, _COOKIES_BROWSER_PROFILE
	_COOKIES_FROM_BROWSER = (browser or None)
	_COOKIES_BROWSER_PROFILE = (profile or None)


def resolve_direct_media(watch_url: str, max_height: int = 720) -> Tuple[str, Dict[str, str]]:
	"""Resolve watch URL -> (direct_url, headers) with in-memory TTL cache."""
	now = time.time()
	key = f"{watch_url}::h{max_height}"
	cached = STREAM_CACHE.get(key)
	if cached and (now - float(cached.get("ts", 0))) < CACHE_TTL_SEC:
		return cached["direct_url"], cached.get("headers", {})  # type: ignore

	ydl_opts: Dict[str, object] = {
		"quiet": True,
		"nocheckcertificate": True,
		"format": (
			f"best[ext=mp4][height<={max_height}][vcodec!=none][acodec!=none]/"
			f"bestvideo[ext=mp4][height<={max_height}][vcodec!=none]+bestaudio[acodec!=none]/"
			f"best[height<={max_height}]"
		),
		"noplaylist": True,
	}
	if _COOKIEFILE:
		ydl_opts["cookiefile"] = _COOKIEFILE
	if _COOKIES_STR:
		# Set default Cookie header for yt_dlp HTTP requests
		h = dict(ydl_opts.get("http_headers") or {})
		h["Cookie"] = _COOKIES_STR
		ydl_opts["http_headers"] = h
	# Use browser cookies only if no cookie file or string are provided
	if not _COOKIEFILE and not _COOKIES_STR and _COOKIES_FROM_BROWSER:
		if _COOKIES_BROWSER_PROFILE:
			ydl_opts["cookiesfrombrowser"] = (_COOKIES_FROM_BROWSER, _COOKIES_BROWSER_PROFILE)
		else:
			ydl_opts["cookiesfrombrowser"] = (_COOKIES_FROM_BROWSER,)

	try:
		with yt_dlp.YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(watch_url, download=False)
	except DownloadError:
		# Relax constraints if requested format combo is unavailable
		fallback_opts: Dict[str, object] = {
			"quiet": True,
			"nocheckcertificate": True,
			"noplaylist": True,
		}
		# Preserve cookies/headers in fallback
		if _COOKIEFILE:
			fallback_opts["cookiefile"] = _COOKIEFILE
		if _COOKIES_STR:
			h = dict(fallback_opts.get("http_headers") or {})
			h["Cookie"] = _COOKIES_STR
			fallback_opts["http_headers"] = h
		# Also try cookies from browser on fallback if applicable
		if not _COOKIEFILE and not _COOKIES_STR and _COOKIES_FROM_BROWSER:
			if _COOKIES_BROWSER_PROFILE:
				fallback_opts["cookiesfrombrowser"] = (_COOKIES_FROM_BROWSER, _COOKIES_BROWSER_PROFILE)
			else:
				fallback_opts["cookiesfrombrowser"] = (_COOKIES_FROM_BROWSER,)
		with yt_dlp.YoutubeDL(fallback_opts) as ydl:
			info = ydl.extract_info(watch_url, download=False)

	direct_url = info.get("url")
	headers = dict(info.get("http_headers") or {})
	# Ensure Cookie header present if provided
	if _COOKIES_STR and "Cookie" not in headers:
		headers["Cookie"] = _COOKIES_STR
	if not direct_url:
		chosen_fmt = _pick_progressive_mp4(info, max_height=max_height)
		if chosen_fmt:
			direct_url = chosen_fmt.get("url")
			headers.update(chosen_fmt.get("http_headers") or {})
			if _COOKIES_STR and "Cookie" not in headers:
				headers["Cookie"] = _COOKIES_STR

	if not direct_url:
		raise RuntimeError("No progressive MP4 found. Try a lower quality.")

	# Keep lightweight metadata from stream extraction for potential reuse.
	VIDEO_INFO_CACHE[watch_url] = {
		"comments": info.get("comments") or [],
		"ts": now,
	}

	STREAM_CACHE[key] = {"direct_url": direct_url, "headers": headers, "ts": now}
	return direct_url, headers 


def fetch_youtube_comments(watch_url: str, max_comments: int = 80, comment_sort: str = "top") -> List[Dict[str, Any]]:
	"""Fetch YouTube comments using yt_dlp with short-lived in-memory cache.

	Returns a list of comment objects as provided by yt_dlp's extractor.
	"""
	clean_max = max(1, min(int(max_comments or 80), 300))
	sort_mode = "new" if str(comment_sort).lower() == "new" else "top"
	cache_key = f"{watch_url}::m{clean_max}::s{sort_mode}"
	now = time.time()
	cached = COMMENTS_CACHE.get(cache_key)
	if cached and (now - float(cached.get("ts", 0))) < COMMENTS_CACHE_TTL_SEC:
		return cached.get("comments", [])  # type: ignore[return-value]

	# yt-dlp may include comments in normal video extraction when it is quick.
	# Reuse those if available to avoid a second extractor call.
	video_info = VIDEO_INFO_CACHE.get(watch_url)
	if video_info and (now - float(video_info.get("ts", 0))) < VIDEO_INFO_CACHE_TTL_SEC:
		quick_comments = video_info.get("comments") or []
		if isinstance(quick_comments, list) and quick_comments:
			COMMENTS_CACHE[cache_key] = {"comments": quick_comments, "ts": now}
			return quick_comments

	ydl_opts: Dict[str, object] = {
		"quiet": True,
		"no_warnings": True,
		"skip_download": True,
		"nocheckcertificate": True,
		"noplaylist": True,
		"extract_flat": False,
		"getcomments": True,
		"extractor_args": {
			"youtube": {
				"comment_sort": [sort_mode],
				"max_comments": [str(clean_max)],
			}
		},
	}

	with yt_dlp.YoutubeDL(ydl_opts) as ydl:
		info = ydl.extract_info(watch_url, download=False)

	comments = info.get("comments") or []
	# print first comment in console for debugging
	# if isinstance(comments, list) and comments:
	# 	print("First comment fetched:", comments[0])
  
	if not isinstance(comments, list):
		comments = []

	COMMENTS_CACHE[cache_key] = {"comments": comments, "ts": now}
	return comments
