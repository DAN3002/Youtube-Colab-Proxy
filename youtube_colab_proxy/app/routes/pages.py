"""Server-side rendered page routes.

Each route fetches data via yt-dlp and passes it to a Jinja2 template.
This provides proper URLs, browser history, and bookmarkable pages.
"""

import asyncio
import re
from typing import Optional

from fastapi import APIRouter, Query, Request
from fastapi.responses import RedirectResponse

from ..dependencies import (
	templates,
	YOUTUBE_ID_RE,
	normalize_list_url,
	build_ydl_base_opts,
	format_duration,
)
from ... import const as _const

router = APIRouter(tags=["pages"])


# ---------------------------------------------------------------------------
# Home
# ---------------------------------------------------------------------------

@router.get("/")
async def home(request: Request):
	return templates.TemplateResponse(request, "home.html", {
		"faq_url": _const.FAQ_URL,
	})


# ---------------------------------------------------------------------------
# Search results
# ---------------------------------------------------------------------------

@router.get("/results")
async def search_results(request: Request, search_query: str = Query(""), page: int = Query(1)):
	q = search_query.strip()
	page = max(1, page)
	items = []
	has_more = False
	error = None

	if q:
		try:
			import yt_dlp

			ydl_opts = build_ydl_base_opts()
			ydl_opts.update({
				"extract_flat": True,
				"skip_download": True,
				"noplaylist": True,
			})
			need_count = max(1, min(page * _const.PL_PAGE_SIZE, 200))
			query_str = f"ytsearch{need_count}:{q}"
			def _do_search():
				with yt_dlp.YoutubeDL(ydl_opts) as ydl:
					return ydl.extract_info(query_str, download=False)

			info = await asyncio.to_thread(_do_search)

			entries = info.get("entries") or []
			start = (page - 1) * _const.PL_PAGE_SIZE
			end = min(start + _const.PL_PAGE_SIZE, len(entries))
			page_entries = entries[start:end]

			for e in page_entries:
				vid = (e.get("id") or e.get("url") or "").strip()
				title = (e.get("title") or "").strip()
				dur = e.get("duration") or e.get("duration_string") or ""
				ch = (e.get("uploader") or e.get("channel") or "").strip()
				if not (vid and YOUTUBE_ID_RE.match(vid)):
					continue
				items.append({
					"id": vid,
					"title": title,
					"duration": format_duration(dur),
					"channel": ch,
				})
			has_more = len(entries) > end or (len(page_entries) == _const.PL_PAGE_SIZE and need_count == page * _const.PL_PAGE_SIZE)
		except Exception as e:
			error = str(e)

	total_pages = page + (1 if has_more else 0)

	return templates.TemplateResponse(request, "search.html", {
		"faq_url": _const.FAQ_URL,
		"query": q,
		"items": items,
		"page": page,
		"has_more": has_more,
		"total_pages": total_pages,
		"error": error,
	})


# ---------------------------------------------------------------------------
# Watch video
# ---------------------------------------------------------------------------

@router.get("/watch")
async def watch_video(
	request: Request,
	v: str = Query(""),
	list: Optional[str] = Query(None),
	index: Optional[int] = Query(None),
):
	vid = v.strip()
	playlist_id = (list or "").strip() if list else None

	if not vid or not YOUTUBE_ID_RE.match(vid):
		return templates.TemplateResponse(request, "watch.html", {
			"faq_url": _const.FAQ_URL,
			"video_id": None,
			"error": "Invalid or missing video ID.",
			"playlist_id": None,
			"playlist_items": [],
			"playlist_index": 0,
		})

	# If playlist context, fetch playlist items
	playlist_items = []
	if playlist_id:
		try:
			import yt_dlp

			pl_url = f"https://www.youtube.com/playlist?list={playlist_id}"
			ydl_opts = build_ydl_base_opts()
			ydl_opts.update({
				"extract_flat": True,
				"skip_download": True,
			})
			def _do_playlist():
				with yt_dlp.YoutubeDL(ydl_opts) as ydl:
					return ydl.extract_info(pl_url, download=False)

			info = await asyncio.to_thread(_do_playlist)
			for e in (info.get("entries") or []):
				eid = (e.get("id") or e.get("url") or "").strip()
				etitle = (e.get("title") or "").strip()
				edur = e.get("duration") or e.get("duration_string") or ""
				ech = (e.get("uploader") or e.get("channel") or "").strip()
				if eid and YOUTUBE_ID_RE.match(eid):
					playlist_items.append({
						"id": eid,
						"title": etitle or "(no title)",
						"duration": format_duration(edur),
						"channel": ech,
					})
		except Exception:
			pass

	return templates.TemplateResponse(request, "watch.html", {
		"faq_url": _const.FAQ_URL,
		"video_id": vid,
		"playlist_id": playlist_id,
		"playlist_items": playlist_items,
		"playlist_index": (index or 0),
		"error": None,
	})


# ---------------------------------------------------------------------------
# Playlist view
# ---------------------------------------------------------------------------

@router.get("/playlist")
async def playlist_view(request: Request, list: str = Query(""), page: int = Query(1)):
	playlist_id = list.strip()
	page = max(1, page)
	items = []
	total = 0
	total_pages = 1
	playlist_title = ""
	playlist_channel = ""
	channel_handle = ""
	error = None

	if not playlist_id:
		error = "Missing playlist ID."
	else:
		try:
			import yt_dlp

			pl_url = f"https://www.youtube.com/playlist?list={playlist_id}"
			ydl_opts = build_ydl_base_opts()
			ydl_opts.update({
				"extract_flat": True,
				"skip_download": True,
			})
			def _do_pl_view():
				with yt_dlp.YoutubeDL(ydl_opts) as ydl:
					return ydl.extract_info(pl_url, download=False)

			info = await asyncio.to_thread(_do_pl_view)

			playlist_title = info.get("title") or ""
			playlist_channel = info.get("uploader") or info.get("channel") or ""

			# Extract channel handle for linking
			channel_url = (info.get("channel_url") or info.get("uploader_url") or "").strip()
			channel_id = (info.get("channel_id") or info.get("uploader_id") or "").strip()
			if channel_url:
				m = re.search(r'youtube\.com/(@[A-Za-z0-9_.-]+)', channel_url)
				if m:
					channel_handle = m.group(1)
				elif channel_id and channel_id.startswith("UC"):
					channel_handle = channel_id
			elif channel_id:
				channel_handle = channel_id

			entries = info.get("entries") or []
			total = len(entries)
			total_pages = max(1, (total + _const.PL_PAGE_SIZE - 1) // _const.PL_PAGE_SIZE)
			start = (page - 1) * _const.PL_PAGE_SIZE
			end = min(start + _const.PL_PAGE_SIZE, total)

			for e in entries[start:end]:
				vid = (e.get("id") or e.get("url") or "").strip()
				title = (e.get("title") or "").strip()
				dur = e.get("duration") or e.get("duration_string") or ""
				ch = (e.get("uploader") or e.get("channel") or "").strip()
				if vid and YOUTUBE_ID_RE.match(vid):
					items.append({
						"id": vid,
						"title": title or "(no title)",
						"duration": format_duration(dur),
						"channel": ch,
					})
		except Exception as e:
			error = str(e)

	return templates.TemplateResponse(request, "playlist.html", {
		"faq_url": _const.FAQ_URL,
		"playlist_id": playlist_id,
		"playlist_title": playlist_title,
		"playlist_channel": playlist_channel,
		"channel_handle": channel_handle,
		"items": items,
		"page": page,
		"total": total,
		"total_pages": total_pages,
		"error": error,
	})


# ---------------------------------------------------------------------------
# Channel view (CSR shell – all data loaded client-side via /api/channel/*)
# ---------------------------------------------------------------------------

@router.get("/channel/{handle:path}")
async def channel_view(request: Request, handle: str):
	if not handle:
		return templates.TemplateResponse(request, "channel.html", {
			"faq_url": _const.FAQ_URL,
			"handle": "",
			"error": "Missing channel identifier.",
		})

	return templates.TemplateResponse(request, "channel.html", {
		"faq_url": _const.FAQ_URL,
		"handle": handle,
		"error": None,
	})
