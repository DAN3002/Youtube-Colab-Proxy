"""Shared helpers and utilities for route handlers."""

import os
import re
from typing import Dict, Optional, Tuple
from urllib.parse import quote, urlparse

import requests as _requests

from .. import const as _const
from ..utils.input import normalize_youtube_url, YOUTUBE_ID_RE  # noqa: F401

# ---------------------------------------------------------------------------
# Jinja2 template engine (singleton)
# ---------------------------------------------------------------------------
from fastapi.templating import Jinja2Templates

TEMPLATES_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "templates")
templates = Jinja2Templates(directory=TEMPLATES_DIR)

# ---------------------------------------------------------------------------
# Thumbnail / image proxying
# ---------------------------------------------------------------------------

THUMB_HEADERS = {
	"User-Agent": "Mozilla/5.0",
	"Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
	"Referer": "https://www.youtube.com/",
}


def to_proxy_image_url(raw_url: str) -> str:
	"""Convert a remote image URL to our local proxy endpoint."""
	if not raw_url:
		return ""
	try:
		u = urlparse(raw_url)
		if u.scheme not in ("http", "https"):
			return ""
		return f"/api/image-proxy?u={quote(raw_url, safe='')}"
	except Exception:
		return ""


def fetch_remote_image_bytes(img_url: str) -> Tuple[Optional[bytes], Optional[str]]:
	s = _requests.Session()
	if _const.OUTBOUND_PROXY:
		s.proxies.update({"http": _const.OUTBOUND_PROXY, "https": _const.OUTBOUND_PROXY})
	r = s.get(img_url, timeout=12, headers=THUMB_HEADERS)
	if r.status_code == 200 and r.content:
		ctype = r.headers.get("Content-Type", "image/jpeg")
		return r.content, ctype
	return None, None


def pick_thumb_candidates(vid: str, pref: str = "hq"):
	order_map = {
		"max": ["maxresdefault.jpg", "sddefault.jpg", "hqdefault.jpg", "mqdefault.jpg", "default.jpg"],
		"sd": ["sddefault.jpg", "hqdefault.jpg", "mqdefault.jpg", "default.jpg"],
		"hq": ["hqdefault.jpg", "sddefault.jpg", "mqdefault.jpg", "default.jpg"],
		"mq": ["mqdefault.jpg", "hqdefault.jpg", "sddefault.jpg", "default.jpg"],
		"def": ["default.jpg", "mqdefault.jpg", "hqdefault.jpg"],
	}
	return [f"https://i.ytimg.com/vi/{vid}/{path}" for path in order_map.get(pref, order_map["hq"])]


def fetch_thumb_bytes(vid: str, pref: str = "hq") -> Tuple[Optional[bytes], Optional[str]]:
	s = _requests.Session()
	if _const.OUTBOUND_PROXY:
		s.proxies.update({"http": _const.OUTBOUND_PROXY, "https": _const.OUTBOUND_PROXY})
	for url in pick_thumb_candidates(vid, pref):
		try:
			r = s.get(url, timeout=10, headers=THUMB_HEADERS)
			if r.status_code == 200 and r.content:
				ctype = r.headers.get("Content-Type", "image/jpeg")
				return r.content, ctype
		except Exception:
			continue
	return None, None


# ---------------------------------------------------------------------------
# URL helpers
# ---------------------------------------------------------------------------

def normalize_list_url(u: str) -> str:
	"""Ensure channel URLs point to the uploads tab to list videos."""
	try:
		low = u.lower()
		if "youtube.com/" in low:
			is_channel = ("youtube.com/@" in low) or ("/channel/" in low) or ("/user/" in low) or ("/c/" in low)
			if is_channel and "/videos" not in low and "/shorts" not in low and "/streams" not in low and "/live" not in low:
				if u.endswith("/"):
					return u + "videos"
				return u + "/videos"
	except Exception:
		pass
	return u


def build_ydl_base_opts() -> Dict:
	"""Build baseline yt-dlp options with locale/proxy settings."""
	opts: Dict = {
		"quiet": True,
		"http_headers": {
			"Accept-Language": _const.YT_LANG,
		},
		"geo_bypass_country": _const.YT_GEO_BYPASS_COUNTRY,
		"js_runtimes": {"deno": {}, "node": {}},
	}
	if _const.OUTBOUND_PROXY:
		opts["proxy"] = _const.OUTBOUND_PROXY
	return opts


# ---------------------------------------------------------------------------
# Duration formatting
# ---------------------------------------------------------------------------

def format_duration(d) -> str:
	"""Convert seconds (int/float) or a string to HH:MM:SS / M:SS format."""
	if d is None or d == "":
		return ""
	if isinstance(d, str):
		s = d.strip()
		# Already formatted
		if re.match(r'^\d{1,2}:\d{2}(:\d{2})?$', s):
			return s
		try:
			d = int(s)
		except (ValueError, TypeError):
			return s
	sec = int(d) if d else 0
	if sec <= 0:
		return ""
	h = sec // 3600
	m = (sec % 3600) // 60
	s = sec % 60
	if h > 0:
		return f"{h}:{m:02d}:{s:02d}"
	return f"{m}:{s:02d}"
