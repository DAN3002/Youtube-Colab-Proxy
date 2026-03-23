"""JSON API routes – /api/*

Handles search, playlist listing, formats, comments, version, thumbnails,
and image proxying.  Migrated from the original Flask __init__.py.
"""

from typing import Optional
from urllib.parse import urlparse

from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import JSONResponse

from ..dependencies import (
	YOUTUBE_ID_RE,
	normalize_youtube_url,
	to_proxy_image_url,
	fetch_remote_image_bytes,
	fetch_thumb_bytes,
	normalize_list_url,
	build_ydl_base_opts,
)
from ...services.resolver import resolve_direct_media, fetch_youtube_comments

router = APIRouter(tags=["api"])


# ---- /api/version --------------------------------------------------------

@router.get("/version")
async def api_version():
	try:
		import importlib.metadata
		version = importlib.metadata.version("youtube-colab-proxy")
		return {"version": version}
	except Exception:
		return {"version": "dev"}


# ---- /api/thumb/<vid> -----------------------------------------------------

@router.get("/thumb/{vid}")
async def api_thumb(vid: str, q: str = Query("hq")):
	if not YOUTUBE_ID_RE.match(vid):
		return Response("Invalid video id", status_code=400)
	data, ctype = fetch_thumb_bytes(vid, pref=q)
	if not data:
		return Response("Thumbnail not found", status_code=404)
	return Response(content=data, status_code=200, media_type=ctype or "image/jpeg",
					headers={"Cache-Control": "public, max-age=3600"})


# ---- /api/image-proxy -----------------------------------------------------

@router.get("/image-proxy")
async def api_image_proxy(u: str = Query("")):
	raw = u.strip()
	if not raw:
		return Response("Missing image url", status_code=400)
	try:
		parsed = urlparse(raw)
		if parsed.scheme not in ("http", "https"):
			return Response("Invalid image url", status_code=400)
	except Exception:
		return Response("Invalid image url", status_code=400)

	data, ctype = fetch_remote_image_bytes(raw)
	if not data:
		return Response("Image not found", status_code=404)
	return Response(content=data, status_code=200, media_type=ctype or "image/jpeg",
					headers={"Cache-Control": "public, max-age=1800"})


# ---- /api/search ----------------------------------------------------------

@router.get("/search")
async def api_search(q: str = Query(""), page: int = Query(1)):
	q = q.strip()
	page = max(1, page)
	if not q:
		return {"items": [], "page": page, "pageSize": 0, "hasMore": False}
	try:
		from ...const import PL_PAGE_SIZE
		import yt_dlp
		from ... import const as _const

		ydl_opts = build_ydl_base_opts()
		ydl_opts.update({
			"extract_flat": True,
			"skip_download": True,
			"noplaylist": True,
		})
		need_count = max(1, min(page * PL_PAGE_SIZE, 200))
		query = f"ytsearch{need_count}:{q}"
		with yt_dlp.YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(query, download=False)

		entries = info.get("entries") or []
		start = (page - 1) * PL_PAGE_SIZE
		end = min(start + PL_PAGE_SIZE, len(entries))
		page_entries = entries[start:end]
		items = []
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
				"duration": dur if isinstance(dur, str) else (str(dur) if dur else ""),
				"channel": ch,
				"watchUrl": f"https://www.youtube.com/watch?v={vid}",
				"stream": f"/stream?id={vid}",
				"thumb": f"/api/thumb/{vid}?q=hq",
			})
		has_more = len(entries) > end or (len(page_entries) == PL_PAGE_SIZE and need_count == page * PL_PAGE_SIZE)
		return {"items": items, "page": page, "pageSize": PL_PAGE_SIZE, "hasMore": bool(has_more)}
	except Exception as e:
		return JSONResponse({"items": [], "page": page, "pageSize": 0, "hasMore": False, "error": str(e)}, status_code=500)


# ---- /api/playlist --------------------------------------------------------

@router.get("/playlist")
async def api_playlist(url: str = Query(""), page: int = Query(1)):
	raw_url = url.strip()
	page = max(1, page)
	if not raw_url:
		return JSONResponse({"items": [], "error": "Missing url"}, status_code=400)

	from ...const import PL_PAGE_SIZE
	import yt_dlp

	ydl_opts = build_ydl_base_opts()
	ydl_opts.update({
		"extract_flat": True,
		"skip_download": True,
	})
	try:
		norm_url = normalize_list_url(raw_url)
		with yt_dlp.YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(norm_url, download=False)
		entries = info.get("entries") or []
		total = len(entries)
		start = (page - 1) * PL_PAGE_SIZE
		end = min(start + PL_PAGE_SIZE, total)
		page_entries = entries[start:end]
		items = []
		for e in page_entries:
			vid = (e.get("id") or e.get("url") or "").strip()
			title = (e.get("title") or "").strip()
			if not (vid and YOUTUBE_ID_RE.match(vid)):
				continue
			ch = (e.get("uploader") or e.get("channel") or "").strip()
			dur = e.get("duration") or e.get("duration_string") or ""
			items.append({
				"id": vid,
				"title": title or "(no title)",
				"channel": ch,
				"duration": dur if isinstance(dur, str) else (str(dur) if dur else ""),
				"watchUrl": f"https://www.youtube.com/watch?v={vid}",
				"stream": f"/stream?id={vid}",
				"thumb": f"/api/thumb/{vid}?q=hq",
			})
		return {
			"items": items,
			"page": page,
			"pageSize": PL_PAGE_SIZE,
			"total": total,
			"totalPages": (total + PL_PAGE_SIZE - 1) // PL_PAGE_SIZE,
		}
	except Exception as e:
		return JSONResponse({"items": [], "error": str(e)}, status_code=500)


# ---- /api/formats ---------------------------------------------------------

@router.get("/formats")
async def api_formats(url: str = Query(""), id: str = Query("")):
	if url.strip():
		watch_url = normalize_youtube_url(url.strip())
	elif id.strip() and YOUTUBE_ID_RE.match(id.strip()):
		watch_url = f"https://www.youtube.com/watch?v={id.strip()}"
	else:
		return {"formats": []}
	try:
		import yt_dlp

		ydl_opts = build_ydl_base_opts()
		ydl_opts.update({
			"skip_download": True,
			"nocheckcertificate": True,
		})
		with yt_dlp.YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(watch_url, download=False)
		fmts = info.get("formats") or []
		heights = set()
		for f in fmts:
			try:
				if (f.get("vcodec") and f.get("vcodec") != "none") and (f.get("acodec") and f.get("acodec") != "none"):
					h = int(f.get("height") or 0)
					if h > 0:
						heights.add(h)
			except Exception:
				continue
		out = sorted(list(heights), reverse=True)
		return {"formats": [{"height": h, "label": f"{h}p"} for h in out]}
	except Exception as e:
		return {"formats": [], "error": str(e)}


# ---- /api/comments --------------------------------------------------------

@router.get("/comments")
async def api_comments(
	url: str = Query(""),
	id: str = Query(""),
	limit: int = Query(80),
	sort: str = Query("top"),
):
	url_param = url.strip()
	id_param = id.strip()
	if url_param:
		watch_url = normalize_youtube_url(url_param)
	elif id_param and YOUTUBE_ID_RE.match(id_param):
		watch_url = f"https://www.youtube.com/watch?v={id_param}"
	else:
		return JSONResponse({"comments": [], "error": "Missing or invalid url/id"}, status_code=400)

	limit = max(1, min(limit, 300))
	sort_mode = "new" if sort.lower() == "new" else "top"

	try:
		raw_comments = fetch_youtube_comments(watch_url, max_comments=limit, comment_sort=sort_mode)
		top_level = []
		replies_by_parent = {}

		def _normalize_comment(c):
			cid = str(c.get("id") or "")
			text = c.get("text")
			if isinstance(text, list):
				text = "\n".join(str(x) for x in text if x is not None)
			text = str(text or "").strip()
			if not cid or not text:
				return None
			raw_thumb = str(c.get("author_thumbnail") or "")
			return {
				"id": cid,
				"author": str(c.get("author") or "Unknown"),
				"author_thumbnail": to_proxy_image_url(raw_thumb),
				"text": text,
				"like_count": int(c.get("like_count") or 0),
				"timestamp": c.get("timestamp"),
			}

		for c in raw_comments:
			if not isinstance(c, dict):
				continue
			cid = str(c.get("id") or "")
			if not cid:
				continue
			parent = str(c.get("parent") or "").strip()
			if parent and parent.lower() != "root":
				norm_reply = _normalize_comment(c)
				if not norm_reply:
					continue
				replies_by_parent.setdefault(parent, []).append(norm_reply)
			else:
				top_level.append(c)

		comments = []
		for c in top_level:
			norm = _normalize_comment(c)
			if not norm:
				continue
			cid = norm["id"]
			replies = replies_by_parent.get(cid, [])
			norm["reply_count"] = len(replies)
			norm["replies"] = replies
			comments.append(norm)

		return {
			"comments": comments,
			"count": len(comments),
			"sort": sort_mode,
			"limit": limit,
		}
	except Exception as e:
		return JSONResponse({"comments": [], "error": str(e)}, status_code=502)
