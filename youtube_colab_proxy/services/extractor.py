from typing import Dict, Any, Optional, Tuple, List

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


def _pick_best_video_audio_pair(
	info_dict: Dict[str, Any], max_height: int = 1080
) -> Optional[Tuple[Dict[str, Any], Dict[str, Any]]]:
	"""Pick the best video-only + best audio-only pair for merging with ffmpeg.

	Returns (video_fmt, audio_fmt) or None if no suitable pair found.
	Prefers mp4/m4a containers for broad compatibility.
	"""
	formats = info_dict.get("formats") or []

	# Collect video-only formats
	video_fmts: List[Tuple[int, int, Dict[str, Any]]] = []
	for fmt in formats:
		vcodec = fmt.get("vcodec") or "none"
		acodec = fmt.get("acodec") or "none"
		if vcodec != "none" and acodec == "none":
			h = int(fmt.get("height") or 0)
			tbr = int(fmt.get("tbr") or fmt.get("vbr") or 0)
			if 0 < h <= max_height:
				# Prefer mp4 container
				ext_prio = 1 if fmt.get("ext") == "mp4" else 0
				video_fmts.append((h, ext_prio, fmt))

	# Collect audio-only formats
	audio_fmts: List[Tuple[int, int, Dict[str, Any]]] = []
	for fmt in formats:
		vcodec = fmt.get("vcodec") or "none"
		acodec = fmt.get("acodec") or "none"
		if acodec != "none" and vcodec == "none":
			abr = int(fmt.get("abr") or fmt.get("tbr") or 0)
			# Prefer m4a/mp4 container for compatibility
			ext_prio = 1 if fmt.get("ext") in ("m4a", "mp4") else 0
			audio_fmts.append((abr, ext_prio, fmt))

	if not video_fmts or not audio_fmts:
		return None

	# Sort: highest height first, then prefer mp4
	video_fmts.sort(key=lambda x: (x[0], x[1]), reverse=True)
	# Sort: highest bitrate first, then prefer m4a
	audio_fmts.sort(key=lambda x: (x[0], x[1]), reverse=True)

	return video_fmts[0][2], audio_fmts[0][2]


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
		"js_runtimes": {"deno": {}, "node": {}},
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
			"js_runtimes": {"deno": {}, "node": {}},
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
