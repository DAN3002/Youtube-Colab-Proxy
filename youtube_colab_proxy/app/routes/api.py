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
from ...services.resolver import resolve_direct_media, fetch_youtube_comments, fetch_comment_replies

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


# ---- /api/video-info ------------------------------------------------------

@router.get("/video-info")
async def api_video_info(id: str = Query("")):
	"""Fetch video metadata: title, channel, avatar, description, and recommended videos."""
	vid = id.strip()
	if not vid or not YOUTUBE_ID_RE.match(vid):
		return JSONResponse({"error": "Missing or invalid video id"}, status_code=400)

	try:
		import yt_dlp

		watch_url = f"https://www.youtube.com/watch?v={vid}"
		ydl_opts = build_ydl_base_opts()
		ydl_opts.update({
			"skip_download": True,
			"nocheckcertificate": True,
			"noplaylist": True,
		})
		with yt_dlp.YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(watch_url, download=False)

		# --- Channel info ---
		channel_name = (info.get("channel") or info.get("uploader") or "").strip()
		channel_id = (info.get("channel_id") or info.get("uploader_id") or "").strip()
		channel_url = (info.get("channel_url") or info.get("uploader_url") or "").strip()

		# Build internal channel link handle
		channel_handle = ""
		if channel_url:
			import re as _re
			m = _re.search(r'youtube\.com/(@[A-Za-z0-9_.-]+)', channel_url)
			if m:
				channel_handle = m.group(1)
			elif channel_id and channel_id.startswith("UC"):
				channel_handle = channel_id
		elif channel_id:
			channel_handle = channel_id

		# Channel avatar / thumbnail
		raw_avatar = ""
		thumbnails = info.get("thumbnails") or []
		# yt-dlp doesn't directly provide channel avatar in video info,
		# so we use a known YouTube pattern
		if channel_id:
			# We'll let the frontend use the image proxy if needed
			raw_avatar = ""  # will be fetched client-side if needed

		# --- Video metadata ---
		title = (info.get("title") or info.get("fulltitle") or "").strip()
		description = (info.get("description") or "").strip()
		view_count = info.get("view_count")
		like_count = info.get("like_count")
		upload_date = info.get("upload_date") or ""
		duration = info.get("duration") or 0

		# --- Available formats / qualities ---
		fmts = info.get("formats") or []
		heights = set()
		best_auto_height = 0
		for f in fmts:
			try:
				has_video = f.get("vcodec") and f.get("vcodec") != "none"
				has_audio = f.get("acodec") and f.get("acodec") != "none"
				h = int(f.get("height") or 0)
				if has_video and h > 0:
					heights.add(h)
					if has_audio and h > best_auto_height:
						best_auto_height = h
			except Exception:
				continue
		sorted_heights = sorted(list(heights), reverse=True)
		formats = [{"height": h, "label": f"{h}p"} for h in sorted_heights]

		# --- Recommended / related videos ---
		# yt-dlp doesn't return "related" videos directly in extract_info,
		# so we use YouTube search with the video title as a proxy for recommendations
		recommendations = []
		if title:
			try:
				rec_opts = build_ydl_base_opts()
				rec_opts.update({
					"extract_flat": True,
					"skip_download": True,
					"noplaylist": True,
				})
				search_query = f"ytsearch15:{title}"
				with yt_dlp.YoutubeDL(rec_opts) as ydl_rec:
					rec_info = ydl_rec.extract_info(search_query, download=False)
				rec_entries = rec_info.get("entries") or []
				for e in rec_entries:
					eid = (e.get("id") or e.get("url") or "").strip()
					etitle = (e.get("title") or "").strip()
					edur = e.get("duration") or e.get("duration_string") or ""
					ech = (e.get("uploader") or e.get("channel") or "").strip()
					if not eid or not YOUTUBE_ID_RE.match(eid):
						continue
					if eid == vid:
						continue  # Skip the current video
					recommendations.append({
						"id": eid,
						"title": etitle,
						"duration": edur if isinstance(edur, str) else (str(edur) if edur else ""),
						"channel": ech,
						"thumb": f"/api/thumb/{eid}?q=mq",
					})
					if len(recommendations) >= 12:
						break
			except Exception:
				pass

		return {
			"id": vid,
			"title": title,
			"channel": channel_name,
			"channel_id": channel_id,
			"channel_handle": channel_handle,
			"channel_url": channel_url,
			"description": description[:500] if description else "",
			"view_count": view_count,
			"like_count": like_count,
			"upload_date": upload_date,
			"duration": duration,
			"formats": formats,
			"best_auto_height": best_auto_height,
			"recommendations": recommendations,
		}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


# ---- /api/comments --------------------------------------------------------

@router.get("/comments")
async def api_comments(
	url: str = Query(""),
	id: str = Query(""),
	limit: int = Query(20),
	sort: str = Query("top"),
):
	"""Fetch top-level comments only (no replies) for speed.
	Use /api/replies to load replies for a specific comment."""
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
		# Fetch top-level only (depth=1) — much faster
		raw_comments = fetch_youtube_comments(
			watch_url, max_comments=limit, comment_sort=sort_mode, include_replies=False
		)

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
				"is_pinned": bool(c.get("is_pinned")),
				"is_favorited": bool(c.get("is_favorited")),
				"timestamp": c.get("timestamp"),
			}

		comments = []
		for c in raw_comments:
			if not isinstance(c, dict):
				continue
			# Skip replies (should not exist with depth=1, but just in case)
			parent = str(c.get("parent") or "").strip()
			if parent and parent.lower() != "root":
				continue
			norm = _normalize_comment(c)
			if norm:
				comments.append(norm)
			# Hard cap at the requested limit
			if len(comments) >= limit:
				break

		return {
			"comments": comments,
			"count": len(comments),
			"sort": sort_mode,
			"limit": limit,
		}
	except Exception as e:
		return JSONResponse({"comments": [], "error": str(e)}, status_code=502)


# ---- /api/replies ---------------------------------------------------------

@router.get("/replies")
async def api_replies(
	id: str = Query(""),
	comment_id: str = Query(""),
	limit: int = Query(50),
	sort: str = Query("top"),
):
	"""Fetch replies to a specific top-level comment."""
	vid = id.strip()
	cid = comment_id.strip()
	if not vid or not YOUTUBE_ID_RE.match(vid):
		return JSONResponse({"replies": [], "error": "Missing or invalid video id"}, status_code=400)
	if not cid:
		return JSONResponse({"replies": [], "error": "Missing comment_id"}, status_code=400)

	limit = max(1, min(limit, 200))
	sort_mode = "new" if sort.lower() == "new" else "top"
	watch_url = f"https://www.youtube.com/watch?v={vid}"

	try:
		raw_replies = fetch_comment_replies(
			watch_url, parent_comment_id=cid, max_replies=limit, comment_sort=sort_mode
		)

		replies = []
		for c in raw_replies:
			if not isinstance(c, dict):
				continue
			rid = str(c.get("id") or "")
			text = c.get("text")
			if isinstance(text, list):
				text = "\n".join(str(x) for x in text if x is not None)
			text = str(text or "").strip()
			if not rid or not text:
				continue
			raw_thumb = str(c.get("author_thumbnail") or "")
			replies.append({
				"id": rid,
				"author": str(c.get("author") or "Unknown"),
				"author_thumbnail": to_proxy_image_url(raw_thumb),
				"text": text,
				"like_count": int(c.get("like_count") or 0),
				"timestamp": c.get("timestamp"),
			})

		return {
			"replies": replies,
			"count": len(replies),
			"parent_id": cid,
		}
	except Exception as e:
		return JSONResponse({"replies": [], "error": str(e)}, status_code=502)


# ---- /api/channel/info ----------------------------------------------------

def _resolve_channel_url(handle: str) -> str:
	"""Build a YouTube channel URL from a handle, channel ID, or username."""
	if handle.startswith("@"):
		return f"https://www.youtube.com/{handle}"
	if handle.startswith("UC"):
		return f"https://www.youtube.com/channel/{handle}"
	return f"https://www.youtube.com/@{handle}"


@router.get("/channel/info")
async def api_channel_info(handle: str = Query("")):
	"""Fetch channel metadata (title, avatar, description) without loading all videos."""
	handle = handle.strip()
	if not handle:
		return JSONResponse({"error": "Missing channel handle"}, status_code=400)

	try:
		import yt_dlp

		channel_url = _resolve_channel_url(handle)
		ydl_opts = build_ydl_base_opts()
		ydl_opts.update({
			"extract_flat": True,
			"skip_download": True,
			"playlist_items": "0",  # Don't download any entries – just metadata
		})
		with yt_dlp.YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(channel_url + "/videos", download=False)

		channel_title = (
			info.get("channel")
			or info.get("uploader")
			or info.get("title")
			or handle
		)
		channel_id = info.get("channel_id") or info.get("uploader_id") or ""

		# yt-dlp exposes channel thumbnails in the thumbnails list
		raw_avatar = ""
		for t in (info.get("thumbnails") or []):
			url = t.get("url") or ""
			if url:
				raw_avatar = url
				break

		description = (info.get("description") or "").strip()

		return {
			"title": channel_title,
			"handle": handle,
			"channel_id": channel_id,
			"channel_url": _resolve_channel_url(handle),
			"avatar": to_proxy_image_url(raw_avatar) if raw_avatar else "",
			"description": description[:500] if description else "",
		}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


# ---- /api/channel/videos --------------------------------------------------

@router.get("/channel/videos")
async def api_channel_videos(handle: str = Query(""), page: int = Query(1)):
	"""Fetch paginated channel videos without loading the entire channel."""
	handle = handle.strip()
	page = max(1, page)
	if not handle:
		return JSONResponse({"items": [], "error": "Missing channel handle"}, status_code=400)

	from ...const import PL_PAGE_SIZE
	import yt_dlp

	try:
		channel_url = _resolve_channel_url(handle)
		videos_url = normalize_list_url(channel_url)

		ydl_opts = build_ydl_base_opts()
		ydl_opts.update({
			"extract_flat": True,
			"skip_download": True,
			"playlistend": page * PL_PAGE_SIZE + 1,  # Fetch just enough to know if there's a next page
		})
		with yt_dlp.YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(videos_url, download=False)

		entries = info.get("entries") or []
		total_fetched = len(entries)
		start = (page - 1) * PL_PAGE_SIZE
		end = min(start + PL_PAGE_SIZE, total_fetched)
		page_entries = entries[start:end]

		items = []
		for e in page_entries:
			vid = (e.get("id") or e.get("url") or "").strip()
			title = (e.get("title") or "").strip()
			if not (vid and YOUTUBE_ID_RE.match(vid)):
				continue
			dur = e.get("duration") or e.get("duration_string") or ""
			ch = (e.get("uploader") or e.get("channel") or "").strip()
			items.append({
				"id": vid,
				"title": title or "(no title)",
				"channel": ch,
				"duration": dur if isinstance(dur, str) else (str(dur) if dur else ""),
				"watchUrl": f"https://www.youtube.com/watch?v={vid}",
				"stream": f"/stream?id={vid}",
				"thumb": f"/api/thumb/{vid}?q=hq",
			})

		has_more = total_fetched > end

		return {
			"items": items,
			"page": page,
			"pageSize": PL_PAGE_SIZE,
			"hasMore": has_more,
		}
	except Exception as e:
		return JSONResponse({"items": [], "error": str(e)}, status_code=500)


# ---- /api/channel/playlists -----------------------------------------------

@router.get("/channel/playlists")
async def api_channel_playlists(handle: str = Query(""), page: int = Query(1)):
	"""Fetch paginated channel playlists."""
	handle = handle.strip()
	page = max(1, page)
	if not handle:
		return JSONResponse({"items": [], "error": "Missing channel handle"}, status_code=400)

	from ...const import PL_PAGE_SIZE
	import yt_dlp

	try:
		channel_url = _resolve_channel_url(handle)
		playlists_url = channel_url + "/playlists"

		ydl_opts = build_ydl_base_opts()
		ydl_opts.update({
			"extract_flat": True,
			"skip_download": True,
		})
		with yt_dlp.YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(playlists_url, download=False)

		entries = info.get("entries") or []
		total = len(entries)
		start = (page - 1) * PL_PAGE_SIZE
		end = min(start + PL_PAGE_SIZE, total)
		page_entries = entries[start:end]

		items = []
		for e in page_entries:
			pl_id = (e.get("id") or e.get("url") or "").strip()
			title = (e.get("title") or "").strip()
			if not pl_id:
				continue
			# Playlists may have a video count
			n_entries = e.get("playlist_count") or e.get("n_entries") or 0
			# Thumbnail: use first video thumb if available
			thumb = ""
			pl_thumbnails = e.get("thumbnails") or []
			if pl_thumbnails:
				thumb = to_proxy_image_url(pl_thumbnails[-1].get("url", ""))
			items.append({
				"id": pl_id,
				"title": title or "(no title)",
				"videoCount": n_entries,
				"thumb": thumb,
				"url": f"/playlist?list={pl_id}",
			})

		has_more = total > end

		return {
			"items": items,
			"page": page,
			"pageSize": PL_PAGE_SIZE,
			"total": total,
			"hasMore": has_more,
		}
	except Exception as e:
		return JSONResponse({"items": [], "error": str(e)}, status_code=500)


# ---- /api/channel/search --------------------------------------------------

@router.get("/channel/search")
async def api_channel_search(
	handle: str = Query(""),
	q: str = Query(""),
	page: int = Query(1),
):
	"""Search for videos within a specific channel."""
	handle = handle.strip()
	q = q.strip()
	page = max(1, page)
	if not handle:
		return JSONResponse({"items": [], "error": "Missing channel handle"}, status_code=400)
	if not q:
		return {"items": [], "page": page, "pageSize": 0, "hasMore": False}

	from ...const import PL_PAGE_SIZE
	import yt_dlp

	try:
		channel_url = _resolve_channel_url(handle)
		# yt-dlp supports channel search via the /search?query= URL pattern
		search_url = f"{channel_url}/search?query={q}"

		ydl_opts = build_ydl_base_opts()
		ydl_opts.update({
			"extract_flat": True,
			"skip_download": True,
		})
		with yt_dlp.YoutubeDL(ydl_opts) as ydl:
			info = ydl.extract_info(search_url, download=False)

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
			dur = e.get("duration") or e.get("duration_string") or ""
			ch = (e.get("uploader") or e.get("channel") or "").strip()
			items.append({
				"id": vid,
				"title": title or "(no title)",
				"channel": ch,
				"duration": dur if isinstance(dur, str) else (str(dur) if dur else ""),
				"watchUrl": f"https://www.youtube.com/watch?v={vid}",
				"stream": f"/stream?id={vid}",
				"thumb": f"/api/thumb/{vid}?q=hq",
			})

		has_more = total > end

		return {
			"items": items,
			"page": page,
			"pageSize": PL_PAGE_SIZE,
			"hasMore": has_more,
		}
	except Exception as e:
		return JSONResponse({"items": [], "error": str(e)}, status_code=500)
