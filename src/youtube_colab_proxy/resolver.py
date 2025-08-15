from typing import Dict, Tuple
import time

import yt_dlp

from .extractor import _pick_progressive_mp4  # type: ignore

STREAM_CACHE: Dict[str, Dict[str, object]] = {}
CACHE_TTL_SEC = 20 * 60


def resolve_direct_media(watch_url: str) -> Tuple[str, Dict[str, str]]:
	"""Resolve watch URL -> (direct_url, headers) with in-memory TTL cache."""
	now = time.time()
	key = watch_url
	cached = STREAM_CACHE.get(key)
	if cached and (now - float(cached.get("ts", 0))) < CACHE_TTL_SEC:
		return cached["direct_url"], cached.get("headers", {})  # type: ignore

	ydl_opts = {
		"quiet": True,
		"nocheckcertificate": True,
		"format": (
			"best[ext=mp4][height<=720][vcodec!=none][acodec!=none]/"
			"bestvideo[ext=mp4][height<=720][vcodec!=none]+bestaudio[acodec!=none]/"
			"best[height<=720]"
		),
		"noplaylist": True,
	}
	with yt_dlp.YoutubeDL(ydl_opts) as ydl:
		info = ydl.extract_info(watch_url, download=False)

	direct_url = info.get("url")
	headers = dict(info.get("http_headers") or {})
	if not direct_url:
		chosen_fmt = _pick_progressive_mp4(info)
		if chosen_fmt:
			direct_url = chosen_fmt.get("url")
			headers.update(chosen_fmt.get("http_headers") or {})

	if not direct_url:
		raise RuntimeError("No progressive MP4 (<=720p) found. Try another video.")

	STREAM_CACHE[key] = {"direct_url": direct_url, "headers": headers, "ts": now}
	return direct_url, headers 
