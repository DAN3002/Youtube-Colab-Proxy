import os
from typing import Dict, Optional

import requests
from flask import Flask, request, jsonify, Response, render_template
from youtubesearchpython import VideosSearch

from ..utils.input import normalize_youtube_url, YOUTUBE_ID_RE
from ..services.resolver import resolve_direct_media
from ..services.streamlink_resolver import (
	get_supported_sites, is_supported_url, get_stream_info,
	resolve_stream_url, get_stream_thumbnail,
	get_best_hls_url, rewrite_hls_manifest
)


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
	from .. import const as _const
	s = requests.Session()
	if _const.OUTBOUND_PROXY:
		s.proxies.update({"http": _const.OUTBOUND_PROXY, "https": _const.OUTBOUND_PROXY})
	for url in _pick_thumb_candidates(vid, pref):
		try:
			r = s.get(url, timeout=10, headers=THUMB_HEADERS)
			if r.status_code == 200 and r.content:
				ctype = r.headers.get("Content-Type", "image/jpeg")
				return r.content, ctype
		except Exception:
			continue
	return None, None


def _normalize_list_url(u: str) -> str:
	"""Ensure channel URLs point to the uploads tab to list videos.
	If URL is a channel-like URL (/@handle, /channel/, /user/, /c/), append /videos if missing.
	"""
	try:
		low = u.lower()
		if "youtube.com/" in low:
			is_channel = ("youtube.com/@" in low) or ("/channel/" in low) or ("/user/" in low) or ("/c/" in low)
			if is_channel and "/videos" not in low and "/shorts" not in low and "/streams" not in low and "/live" not in low:
				if u.endswith('/'):
					return u + "videos"
				return u + "/videos"
	except Exception:
		pass
	return u


def create_app(cookie_file: Optional[str] = None) -> Flask:
	"""Create Flask app with API and frontend routes."""
	templates_dir = os.path.join(os.path.dirname(__file__), "templates")
	app = Flask(__name__, template_folder=templates_dir, static_folder=os.path.join(os.path.dirname(__file__), "static"))
	if cookie_file:
		app.config["YDL_COOKIEFILE"] = cookie_file

	@app.get("/")
	def index():  # type: ignore
		from .. import const as _const
		return render_template("index.html", FAQ_URL=_const.FAQ_URL)

	@app.get("/api/version")
	def api_version():  # type: ignore
		"""Return application version."""
		try:
			import importlib.metadata
			version = importlib.metadata.version("youtube-colab-proxy")
			return jsonify({"version": version})
		except Exception:
			# Fallback if package not installed properly
			return jsonify({"version": "dev"})

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
			from .. import const as _const
			ydl_opts = {
				"quiet": True,
				"extract_flat": True,
				"skip_download": True,
				"noplaylist": True,
				"http_headers": {
					"Accept-Language": _const.YT_LANG,
				},
				"geo_bypass_country": _const.YT_GEO_BYPASS_COUNTRY,
			}
			if _const.OUTBOUND_PROXY:
				ydl_opts["proxy"] = _const.OUTBOUND_PROXY
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
		"""Return paginated items for a playlist or channel URL."""
		raw_url = (request.args.get("url") or "").strip()
		page = int((request.args.get("page") or "1").strip() or 1)
		page = max(1, page)
		if not raw_url:
			return jsonify({"items": [], "error": "Missing url"}), 400
		from ..const import PL_PAGE_SIZE
		import yt_dlp
		from .. import const as _const
		ydl_opts = {
			"quiet": True,
			"extract_flat": True,
			"skip_download": True,
			"http_headers": {
				"Accept-Language": _const.YT_LANG,
			},
			"geo_bypass_country": _const.YT_GEO_BYPASS_COUNTRY,
		}
		if _const.OUTBOUND_PROXY:
			ydl_opts["proxy"] = _const.OUTBOUND_PROXY
		try:
			norm_url = _normalize_list_url(raw_url)
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
			return jsonify({
				"items": items,
				"page": page,
				"pageSize": PL_PAGE_SIZE,
				"total": total,
				"totalPages": (total + PL_PAGE_SIZE - 1) // PL_PAGE_SIZE,
			})
		except Exception as e:
			return jsonify({"items": [], "error": str(e)}), 500

	@app.get("/api/formats")
	def api_formats():  # type: ignore
		"""Return available progressive MP4 resolutions for a given video id or url."""
		url_param = (request.args.get("url") or "").strip()
		id_param = (request.args.get("id") or "").strip()
		if url_param:
			watch_url = normalize_youtube_url(url_param)
		elif id_param and YOUTUBE_ID_RE.match(id_param):
			watch_url = f"https://www.youtube.com/watch?v={id_param}"
		else:
			return jsonify({"formats": []})
		try:
			import yt_dlp
			from .. import const as _const
			ydl_opts = {
				"quiet": True,
				"skip_download": True,
				"nocheckcertificate": True,
				"http_headers": {
					"Accept-Language": _const.YT_LANG,
				},
				"geo_bypass_country": _const.YT_GEO_BYPASS_COUNTRY,
			}
			if _const.OUTBOUND_PROXY:
				ydl_opts["proxy"] = _const.OUTBOUND_PROXY
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
			return jsonify({"formats": [{"height": h, "label": f"{h}p"} for h in out]})
		except Exception as e:
			return jsonify({"formats": [], "error": str(e)})

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
			# Optional max height parameter
			max_h_param = request.args.get("h")
			max_h = None
			try:
				max_h = int(max_h_param) if max_h_param is not None else None
			except Exception:
				max_h = None
			direct_url, ydl_headers = resolve_direct_media(watch_url, max_height=max_h or 10**9)
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

	@app.get("/api/streamlink/sites")
	def api_streamlink_sites():  # type: ignore
		"""Get list of supported streaming sites."""
		try:
			sites = get_supported_sites()
			return jsonify({"sites": sites})
		except Exception as e:
			return jsonify({"error": str(e)}), 500

	@app.get("/api/streamlink/check")
	def api_streamlink_check():  # type: ignore
		"""Check if URL is supported by streamlink."""
		url = (request.args.get("url") or "").strip()
		if not url:
			return jsonify({"supported": False, "error": "Missing url parameter"}), 400
		
		try:
			supported = is_supported_url(url)
			return jsonify({"url": url, "supported": supported})
		except Exception as e:
			return jsonify({"url": url, "supported": False, "error": str(e)})

	@app.get("/api/streamlink/info")
	def api_streamlink_info():  # type: ignore
		"""Get stream information and available qualities."""
		url = (request.args.get("url") or "").strip()
		if not url:
			return jsonify({"error": "Missing url parameter"}), 400
		
		try:
			info = get_stream_info(url)
			return jsonify(info)
		except Exception as e:
			return jsonify({"error": str(e)}), 500

	@app.get("/streamlink")
	def streamlink_stream():  # type: ignore
		"""Stream content via streamlink."""
		import streamlink
		
		url = (request.args.get("url") or "").strip()
		quality = (request.args.get("quality") or "best").strip()
		
		if not url:
			return Response("Missing url parameter", status=400)
		
		try:
			# Get streams from streamlink
			session = streamlink.Streamlink()
			streams = session.streams(url)
			
			if not streams:
				return Response("No streams found for this URL", status=404)
			
			# Get the requested quality or fall back to best
			stream = streams.get(quality) or streams.get('best')
			if not stream:
				# Try to find any available stream
				stream = next(iter(streams.values()))
			
			if not stream:
				return Response("No suitable stream found", status=404)
			
			# Open the stream
			stream_fd = stream.open()
			
			def generate():
				try:
					while True:
						data = stream_fd.read(1024 * 1024)  # Read 1MB chunks
						if not data:
							break
						yield data
				finally:
					stream_fd.close()
			
			# Determine content type
			content_type = "video/mp4"  # Default
			if hasattr(stream, 'container') and stream.container:
				if stream.container == 'hls':
					content_type = "application/vnd.apple.mpegurl"
				elif stream.container in ['mp4', 'webm', 'flv']:
					content_type = f"video/{stream.container}"
			
			resp = Response(generate(), mimetype=content_type)
			resp.headers["Cache-Control"] = "no-cache"
			resp.headers["Accept-Ranges"] = "bytes"
			
			return resp
			
		except Exception as e:
			return Response(f"Streamlink error: {e}", status=502)

	@app.get("/streamlink/hls")
	def streamlink_hls():  # type: ignore
		"""Return a rewritten HLS manifest for a given source URL, proxying all URIs."""
		import requests as _rq
		from urllib.parse import quote
		source_url = (request.args.get("url") or "").strip()
		if not source_url:
			return Response("Missing url", status=400)
		try:
			master = get_best_hls_url(source_url)
			r = _rq.get(master, timeout=20)
			if r.status_code != 200:
				return Response(f"Upstream error {r.status_code}", status=502)
			proxy_base = f"/streamlink/hls/segment?src={quote(master, safe='')}"
			rewritten = rewrite_hls_manifest(r.text, master, proxy_base)
			resp = Response(rewritten, status=200, mimetype="application/vnd.apple.mpegurl")
			resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
			return resp
		except Exception as e:
			return Response(f"HLS error: {e}", status=502)

	@app.get("/streamlink/hls/segment")
	def streamlink_hls_segment():  # type: ignore
		"""Proxy HLS segments or variant playlists referenced by our rewritten manifest."""
		import requests as _rq
		from urllib.parse import unquote
		src = unquote((request.args.get("src") or "").strip())
		u = unquote((request.args.get("u") or "").strip())
		if not (src and u):
			return Response("Missing src/u", status=400)
		try:
			# Fetch the target resource
			r = _rq.get(u, timeout=20, stream=True)
			ct = r.headers.get("Content-Type")
			# Distinguish manifest vs media
			if ct and "mpegurl" in ct:
				# Nested playlist: rewrite again
				rewritten = rewrite_hls_manifest(r.text, u, f"/streamlink/hls/segment?src={src}")
				resp = Response(rewritten, status=200, mimetype="application/vnd.apple.mpegurl")
				resp.headers["Cache-Control"] = "no-cache, no-store, must-revalidate"
				return resp
			# Media segment or key
			resp = Response(r.iter_content(chunk_size=1024 * 256), status=r.status_code)
			if ct:
				resp.headers["Content-Type"] = ct
			for h in ["Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control"]:
				if h in r.headers:
					resp.headers[h] = r.headers[h]
			return resp
		except Exception as e:
			return Response(f"Segment error: {e}", status=502)

	return app 
