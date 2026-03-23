from typing import Dict, Tuple, Optional, List, Any
import time
import os
import hashlib
import subprocess
import shutil
import tempfile
import logging
import threading

import yt_dlp
from yt_dlp.utils import DownloadError

from .extractor import _pick_progressive_mp4, _pick_best_video_audio_pair  # type: ignore

logger = logging.getLogger(__name__)

STREAM_CACHE: Dict[str, Dict[str, object]] = {}
CACHE_TTL_SEC = 20 * 60
COMMENTS_CACHE: Dict[str, Dict[str, object]] = {}
COMMENTS_CACHE_TTL_SEC = 10 * 60
VIDEO_INFO_CACHE: Dict[str, Dict[str, object]] = {}
VIDEO_INFO_CACHE_TTL_SEC = 10 * 60

# Cache for merged files (video+audio merged via ffmpeg)
MERGED_FILE_CACHE: Dict[str, Dict[str, object]] = {}
MERGED_FILE_CACHE_TTL_SEC = 30 * 60  # 30 minutes
_merge_locks: Dict[str, threading.Lock] = {}
_merge_locks_lock = threading.Lock()

# Directory for temporary merged files
_MERGE_TEMP_DIR: Optional[str] = None


def _get_merge_temp_dir() -> str:
	"""Get or create the temp directory for merged files."""
	global _MERGE_TEMP_DIR
	if _MERGE_TEMP_DIR and os.path.isdir(_MERGE_TEMP_DIR):
		return _MERGE_TEMP_DIR
	_MERGE_TEMP_DIR = tempfile.mkdtemp(prefix="ycp_merge_")
	return _MERGE_TEMP_DIR


def _cleanup_old_merged_files():
	"""Remove merged files that have expired from cache."""
	now = time.time()
	expired_keys = []
	for key, entry in MERGED_FILE_CACHE.items():
		if (now - float(entry.get("ts", 0))) > MERGED_FILE_CACHE_TTL_SEC:
			expired_keys.append(key)

	for key in expired_keys:
		entry = MERGED_FILE_CACHE.pop(key, None)
		if entry:
			fpath = entry.get("file_path")
			if fpath and isinstance(fpath, str) and os.path.exists(fpath):
				try:
					os.remove(fpath)
				except OSError:
					pass


def _has_ffmpeg() -> bool:
	"""Check if ffmpeg is available in PATH."""
	return shutil.which("ffmpeg") is not None


def _merge_video_audio(
	video_url: str,
	audio_url: str,
	video_headers: Dict[str, str],
	audio_headers: Dict[str, str],
	output_path: str,
) -> bool:
	"""Download video and audio streams and merge them with ffmpeg.

	Returns True on success, False on failure.
	Uses ffmpeg to read both streams directly from URLs and mux into a single MP4.
	"""
	# Build combined headers (YouTube uses the same headers for both typically)
	# ffmpeg's -headers flag applies globally to all HTTP inputs
	combined_headers = {**video_headers, **audio_headers}
	header_str = "\r\n".join(
		f"{k}: {v}" for k, v in combined_headers.items()
		if k.lower() not in ("host",)
	)

	cmd = ["ffmpeg", "-y"]
	if header_str:
		cmd.extend(["-headers", header_str + "\r\n"])
	cmd.extend([
		"-i", video_url,
		"-i", audio_url,
		"-c:v", "copy",
		"-c:a", "copy",
		"-movflags", "+faststart",
		output_path,
	])

	try:
		result = subprocess.run(
			cmd,
			capture_output=True,
			timeout=300,  # 5 minute timeout
		)
		if result.returncode != 0:
			logger.warning("ffmpeg merge failed (code %d): %s", result.returncode, result.stderr.decode(errors="replace")[-500:])
			return False
		return os.path.exists(output_path) and os.path.getsize(output_path) > 0
	except subprocess.TimeoutExpired:
		logger.warning("ffmpeg merge timed out")
		return False
	except Exception as e:
		logger.warning("ffmpeg merge error: %s", e)
		return False


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


def _apply_cookie_opts(opts: Dict[str, object]) -> None:
	"""Apply cookie/auth settings to yt-dlp options dict."""
	if _COOKIEFILE:
		opts["cookiefile"] = _COOKIEFILE
	if _COOKIES_STR:
		h = dict(opts.get("http_headers") or {})
		h["Cookie"] = _COOKIES_STR
		opts["http_headers"] = h
	if not _COOKIEFILE and not _COOKIES_STR and _COOKIES_FROM_BROWSER:
		if _COOKIES_BROWSER_PROFILE:
			opts["cookiesfrombrowser"] = (_COOKIES_FROM_BROWSER, _COOKIES_BROWSER_PROFILE)
		else:
			opts["cookiesfrombrowser"] = (_COOKIES_FROM_BROWSER,)


def resolve_direct_media(watch_url: str, max_height: int = 720) -> Tuple[str, Dict[str, str]]:
	"""Resolve watch URL -> (direct_url, headers) with in-memory TTL cache.

	For heights > 720p (e.g. 1080p), if no progressive MP4 is available,
	will attempt to merge separate video+audio streams using ffmpeg and
	return a local file path prefixed with 'file://' instead of a remote URL.
	"""
	now = time.time()
	key = f"{watch_url}::h{max_height}"

	# Cleanup old merged files periodically
	_cleanup_old_merged_files()

	# Check merged file cache first (for high-quality merged files)
	merged = MERGED_FILE_CACHE.get(key)
	if merged and (now - float(merged.get("ts", 0))) < MERGED_FILE_CACHE_TTL_SEC:
		fpath = merged.get("file_path")
		if fpath and isinstance(fpath, str) and os.path.exists(fpath):
			return f"file://{fpath}", {}

	# Check stream URL cache
	cached = STREAM_CACHE.get(key)
	if cached and (now - float(cached.get("ts", 0))) < CACHE_TTL_SEC:
		return cached["direct_url"], cached.get("headers", {})  # type: ignore

	# Extract info with all formats available (no format filtering)
	ydl_opts: Dict[str, object] = {
		"quiet": True,
		"nocheckcertificate": True,
		"noplaylist": True,
		"skip_download": True,
		"js_runtimes": {"deno": {}, "node": {}},
	}
	_apply_cookie_opts(ydl_opts)

	with yt_dlp.YoutubeDL(ydl_opts) as ydl:
		info = ydl.extract_info(watch_url, download=False)

	# ---- Strategy 1: Try progressive MP4 (has both video + audio) ----
	chosen_fmt = _pick_progressive_mp4(info, max_height=max_height)
	if chosen_fmt:
		direct_url = chosen_fmt.get("url")
		headers = dict(chosen_fmt.get("http_headers") or info.get("http_headers") or {})
		if _COOKIES_STR and "Cookie" not in headers:
			headers["Cookie"] = _COOKIES_STR
		if direct_url:
			STREAM_CACHE[key] = {"direct_url": direct_url, "headers": headers, "ts": now}
			return direct_url, headers

	# ---- Strategy 2: Merge video-only + audio-only with ffmpeg ----
	if _has_ffmpeg() and max_height > 360:
		pair = _pick_best_video_audio_pair(info, max_height=max_height)
		if pair:
			video_fmt, audio_fmt = pair
			video_url = video_fmt.get("url")
			audio_url = audio_fmt.get("url")

			if video_url and audio_url:
				# Use a lock per cache key to prevent duplicate merges
				with _merge_locks_lock:
					if key not in _merge_locks:
						_merge_locks[key] = threading.Lock()
					lock = _merge_locks[key]

				with lock:
					# Double-check cache after acquiring lock
					merged = MERGED_FILE_CACHE.get(key)
					if merged and (time.time() - float(merged.get("ts", 0))) < MERGED_FILE_CACHE_TTL_SEC:
						fpath = merged.get("file_path")
						if fpath and isinstance(fpath, str) and os.path.exists(fpath):
							return f"file://{fpath}", {}

					vid_h = video_fmt.get("height") or "unknown"
					url_hash = hashlib.md5(watch_url.encode()).hexdigest()[:10]
					merge_dir = _get_merge_temp_dir()
					output_path = os.path.join(merge_dir, f"{url_hash}_{vid_h}p.mp4")

					video_headers = dict(video_fmt.get("http_headers") or info.get("http_headers") or {})
					audio_headers = dict(audio_fmt.get("http_headers") or info.get("http_headers") or {})
					if _COOKIES_STR:
						if "Cookie" not in video_headers:
							video_headers["Cookie"] = _COOKIES_STR
						if "Cookie" not in audio_headers:
							audio_headers["Cookie"] = _COOKIES_STR

					success = _merge_video_audio(video_url, audio_url, video_headers, audio_headers, output_path)
					if success:
						MERGED_FILE_CACHE[key] = {"file_path": output_path, "ts": time.time()}
						return f"file://{output_path}", {}

	# ---- Strategy 3: Fallback – use yt-dlp's auto-selected best format ----
	direct_url = info.get("url")
	headers = dict(info.get("http_headers") or {})
	if _COOKIES_STR and "Cookie" not in headers:
		headers["Cookie"] = _COOKIES_STR

	if direct_url:
		STREAM_CACHE[key] = {"direct_url": direct_url, "headers": headers, "ts": now}
		return direct_url, headers

	raise RuntimeError("No suitable video format found. Try a lower quality.") 


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
