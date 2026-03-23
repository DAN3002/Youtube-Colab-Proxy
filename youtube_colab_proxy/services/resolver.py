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
		"js_runtimes": {"deno": {}, "node": {}},
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
			"js_runtimes": {"deno": {}, "node": {}},
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

	# Keep timestamp for potential reuse (comments are fetched separately now).
	VIDEO_INFO_CACHE[watch_url] = {
		"ts": now,
	}

	STREAM_CACHE[key] = {"direct_url": direct_url, "headers": headers, "ts": now}
	return direct_url, headers 


def fetch_youtube_comments(
	watch_url: str,
	max_comments: int = 20,
	comment_sort: str = "top",
	include_replies: bool = False,
) -> List[Dict[str, Any]]:
	"""Fetch YouTube comments using yt_dlp with short-lived in-memory cache.

	When include_replies=False (default), only top-level comments are fetched
	(depth=1) for speed.  Replies can be loaded separately via fetch_comment_replies().

	Returns a list of comment objects as provided by yt_dlp's extractor.
	"""
	clean_max = max(1, min(int(max_comments or 20), 300))
	sort_mode = "new" if str(comment_sort).lower() == "new" else "top"
	depth = "all" if include_replies else "1"
	cache_key = f"{watch_url}::m{clean_max}::s{sort_mode}::d{depth}"
	now = time.time()
	cached = COMMENTS_CACHE.get(cache_key)
	if cached and (now - float(cached.get("ts", 0))) < COMMENTS_CACHE_TTL_SEC:
		return cached.get("comments", [])

	# NOTE: Do NOT reuse VIDEO_INFO_CACHE for comments here – those may include
	# replies mixed in and have no limit applied. Always fetch fresh with the
	# correct max_comments spec.

	# max_comments format: max-comments,max-parents,max-replies,max-replies-per-thread,max-depth
	# depth=1 means top-level only (no replies) — much faster
	if include_replies:
		max_comments_spec = f"{clean_max},all,all,all,all"
	else:
		max_comments_spec = f"{clean_max},{clean_max},0,0,1"

	ydl_opts: Dict[str, object] = {
		"quiet": True,
		"no_warnings": True,
		"skip_download": True,
		"nocheckcertificate": True,
		"noplaylist": True,
		"extract_flat": False,
		"getcomments": True,
		"js_runtimes": {"deno": {}, "node": {}},
		"extractor_args": {
			"youtube": {
				"comment_sort": [sort_mode],
				"max_comments": [max_comments_spec],
			}
		},
	}

	with yt_dlp.YoutubeDL(ydl_opts) as ydl:
		info = ydl.extract_info(watch_url, download=False)

	comments = info.get("comments") or []
	if not isinstance(comments, list):
		comments = []

	COMMENTS_CACHE[cache_key] = {"comments": comments, "ts": now}
	return comments


def fetch_comment_replies(
	watch_url: str,
	parent_comment_id: str,
	max_replies: int = 50,
	comment_sort: str = "top",
) -> List[Dict[str, Any]]:
	"""Fetch replies to a specific comment. Uses a separate cache key."""
	clean_max = max(1, min(int(max_replies or 50), 200))
	sort_mode = "new" if str(comment_sort).lower() == "new" else "top"
	cache_key = f"{watch_url}::replies::{parent_comment_id}::m{clean_max}::s{sort_mode}"
	now = time.time()
	cached = COMMENTS_CACHE.get(cache_key)
	if cached and (now - float(cached.get("ts", 0))) < COMMENTS_CACHE_TTL_SEC:
		return cached.get("comments", [])

	# Fetch with replies enabled, targeting replies for a specific depth
	# max_comments format: max-comments,max-parents,max-replies,max-replies-per-thread,max-depth
	max_comments_spec = f"all,all,{clean_max},{clean_max},2"

	ydl_opts: Dict[str, object] = {
		"quiet": True,
		"no_warnings": True,
		"skip_download": True,
		"nocheckcertificate": True,
		"noplaylist": True,
		"extract_flat": False,
		"getcomments": True,
		"js_runtimes": {"deno": {}, "node": {}},
		"extractor_args": {
			"youtube": {
				"comment_sort": [sort_mode],
				"max_comments": [max_comments_spec],
			}
		},
	}

	with yt_dlp.YoutubeDL(ydl_opts) as ydl:
		info = ydl.extract_info(watch_url, download=False)

	all_comments = info.get("comments") or []
	if not isinstance(all_comments, list):
		all_comments = []

	# Filter to only replies for the requested parent
	replies = [
		c for c in all_comments
		if isinstance(c, dict) and str(c.get("parent") or "").strip() == parent_comment_id
	]

	COMMENTS_CACHE[cache_key] = {"comments": replies, "ts": now}
	return replies
