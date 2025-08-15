import os
from typing import Dict

import requests
from flask import Flask, request, jsonify, Response, render_template
from youtubesearchpython import VideosSearch

from ..utils.input import normalize_youtube_url, YOUTUBE_ID_RE
from ..services.resolver import resolve_direct_media


THUMB_HEADERS = {
	"User-Agent": "Mozilla/5.0",
	"Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
	"Referer": "https://www.youtube.com/",
}


def _pick_thumb_candidates(vid: str, pref: str = "hq"):
	order_map = {
		"max": ["maxresdefault.jpg", "sddefault.jpg", "hqdefault.jpg", "mqdefault.jpg", "default.jpg"],
		"sd": ["sddefault.jpg", "hqdefault.jpg", "mqdefault.jpg", "default.jpg"],
		"hq": ["hqdefault.jpg", "sddefault.jpg", "mqdefault.jpg", "default.jpg"],
		"mq": ["mqdefault.jpg", "hqdefault.jpg", "sddefault.jpg", "default.jpg"],
		"def": ["default.jpg", "mqdefault.jpg", "hqdefault.jpg"],
	}
	return [f"https://i.ytimg.com/vi/{vid}/{path}" for path in order_map.get(pref, order_map["hq"])]


def _fetch_thumb_bytes(vid: str, pref: str = "hq"):
	for url in _pick_thumb_candidates(vid, pref):
		try:
			r = requests.get(url, timeout=10, headers=THUMB_HEADERS)
			if r.status_code == 200 and r.content:
				ctype = r.headers.get("Content-Type", "image/jpeg")
				return r.content, ctype
		except Exception:
			continue
	return None, None


def create_app() -> Flask:
	"""Create Flask app with API and frontend routes."""
	templates_dir = os.path.join(os.path.dirname(__file__), "templates")
	app = Flask(__name__, template_folder=templates_dir, static_folder=os.path.join(os.path.dirname(__file__), "static"))

	@app.get("/")
	def index():  # type: ignore
		return render_template("index.html")

	@app.get("/api/thumb/<vid>")
	def api_thumb(vid):  # type: ignore
		if not YOUTUBE_ID_RE.match(vid):
			return Response("Invalid video id", status=400)
		pref = request.args.get("q", "hq")
		data, ctype = _fetch_thumb_bytes(vid, pref=pref)
		if not data:
			return Response("Thumbnail not found", status=404)
		resp = Response(data, status=200, mimetype=ctype or "image/jpeg")
		resp.headers["Cache-Control"] = "public, max-age=3600"
		return resp

	@app.get("/api/search")
	def api_search():  # type: ignore
		q = (request.args.get("q") or "").strip()
		page = int((request.args.get("page") or "1").strip() or 1)
		page = max(1, page)
		if not q:
			return jsonify({"items": [], "page": page, "pageSize": 0, "hasMore": False})
		try:
			# Use yt_dlp search to avoid httpx/proxies issues from youtubesearchpython
			from ..const import PL_PAGE_SIZE
			import yt_dlp
			ydl_opts = {"quiet": True, "extract_flat": True, "skip_download": True, "noplaylist": True}
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
				# duration may be in seconds or string; we keep string if available
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
			return jsonify({"items": items, "page": page, "pageSize": PL_PAGE_SIZE, "hasMore": bool(has_more)})
		except Exception as e:
			return jsonify({"items": [], "page": page, "pageSize": 0, "hasMore": False, "error": str(e)}), 500

	@app.get("/api/playlist")
	def api_playlist():  # type: ignore
		raw_url = (request.args.get("url") or "").strip()
		page = int((request.args.get("page") or "1").strip() or 1)
		page = max(1, page)
		if not raw_url:
			return jsonify({"items": [], "error": "Missing url"}), 400
		from ..const import PL_PAGE_SIZE
		import yt_dlp
		ydl_opts = {"quiet": True, "extract_flat": True, "skip_download": True}
		try:
			with yt_dlp.YoutubeDL(ydl_opts) as ydl:
				info = ydl.extract_info(raw_url, download=False)
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
				if isinstance(dur, str):
					dur_str = dur
				else:
					dur_str = str(dur) if dur else ""
				items.append({
					"id": vid,
					"title": title or "(no title)",
					"channel": ch,
					"duration": dur_str,
					"watchUrl": f"https://www.youtube.com/watch?v={vid}",
					"stream": f"/stream?id={vid}",
					"thumb": f"/api/thumb/{vid}?q=hq",
				})
			return jsonify({
				"items": items,
				"page": page,
				"pageSize": PL_PAGE_SIZE,
				"total": total,
				"totalPages": (total + PL_PAGE_SIZE - 1) // PL_PAGE_SIZE,
			})
		except Exception as e:
			return jsonify({"items": [], "error": str(e)}), 500

	@app.get("/stream")
	def stream():  # type: ignore
		url_param = (request.args.get("url") or "").strip()
		id_param = (request.args.get("id") or "").strip()
		if url_param:
			watch_url = normalize_youtube_url(url_param)
		elif id_param and YOUTUBE_ID_RE.match(id_param):
			watch_url = f"https://www.youtube.com/watch?v={id_param}"
		else:
			return Response("Missing or invalid url/id", status=400)
		try:
			direct_url, ydl_headers = resolve_direct_media(watch_url)
		except Exception as e:
			return Response(f"Failed to resolve media: {e}", status=502)

		prox_headers: Dict[str, str] = {}
		for k in [
			"User-Agent",
			"Accept",
			"Accept-Language",
			"Sec-Fetch-Mode",
			"Referer",
			"Origin",
			"Cookie",
		]:
			if k in ydl_headers:
				prox_headers[k] = ydl_headers[k]
		rng = request.headers.get("Range")
		if rng:
			prox_headers["Range"] = rng

		r = requests.get(direct_url, headers=prox_headers, stream=True, timeout=30)
		resp = Response(r.iter_content(chunk_size=1024 * 1024), status=r.status_code)
		resp.headers["Content-Type"] = r.headers.get("Content-Type", "video/mp4")
		for h in [
			"Accept-Ranges",
			"Content-Length",
			"Content-Range",
			"Content-Disposition",
			"ETag",
			"Last-Modified",
			"Cache-Control",
		]:
			if h in r.headers:
				resp.headers[h] = r.headers[h]
		return resp

	return app 
