"""Streamlink routes – /streamlink/*, /api/streamlink/*

Provides live-stream support for platforms like Twitch, Kick, etc.
via the streamlink library.
"""

from urllib.parse import quote, unquote

import requests as _requests
from fastapi import APIRouter, Query, Response
from fastapi.responses import JSONResponse, StreamingResponse

from ...services.streamlink_resolver import (
	get_supported_sites, is_supported_url, get_stream_info,
	resolve_stream_url, get_stream_thumbnail,
	get_best_hls_url, rewrite_hls_manifest,
)

router = APIRouter(tags=["streamlink"])


# ---- /api/streamlink/sites -----------------------------------------------

@router.get("/api/streamlink/sites")
async def api_streamlink_sites():
	try:
		sites = get_supported_sites()
		return {"sites": sites}
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


# ---- /api/streamlink/check -----------------------------------------------

@router.get("/api/streamlink/check")
async def api_streamlink_check(url: str = Query("")):
	url = url.strip()
	if not url:
		return JSONResponse({"supported": False, "error": "Missing url parameter"}, status_code=400)
	try:
		supported = is_supported_url(url)
		return {"url": url, "supported": supported}
	except Exception as e:
		return {"url": url, "supported": False, "error": str(e)}


# ---- /api/streamlink/info ------------------------------------------------

@router.get("/api/streamlink/info")
async def api_streamlink_info(url: str = Query("")):
	url = url.strip()
	if not url:
		return JSONResponse({"error": "Missing url parameter"}, status_code=400)
	try:
		info = get_stream_info(url)
		return info
	except Exception as e:
		return JSONResponse({"error": str(e)}, status_code=500)


# ---- /streamlink ----------------------------------------------------------

@router.get("/streamlink")
async def streamlink_stream(url: str = Query(""), quality: str = Query("best")):
	import streamlink as _sl

	url = url.strip()
	quality = quality.strip()
	if not url:
		return Response("Missing url parameter", status_code=400)
	try:
		session = _sl.Streamlink()
		streams = session.streams(url)
		if not streams:
			return Response("No streams found for this URL", status_code=404)
		stream = streams.get(quality) or streams.get("best")
		if not stream:
			stream = next(iter(streams.values()))
		if not stream:
			return Response("No suitable stream found", status_code=404)

		stream_fd = stream.open()

		def generate():
			try:
				while True:
					data = stream_fd.read(1024 * 1024)
					if not data:
						break
					yield data
			finally:
				stream_fd.close()

		content_type = "video/mp4"
		if hasattr(stream, "container") and stream.container:
			if stream.container == "hls":
				content_type = "application/vnd.apple.mpegurl"
			elif stream.container in ("mp4", "webm", "flv"):
				content_type = f"video/{stream.container}"

		return StreamingResponse(generate(), media_type=content_type,
								headers={"Cache-Control": "no-cache", "Accept-Ranges": "bytes"})
	except Exception as e:
		return Response(f"Streamlink error: {e}", status_code=502)


# ---- /streamlink/hls ------------------------------------------------------

@router.get("/streamlink/hls")
async def streamlink_hls(url: str = Query("")):
	source_url = url.strip()
	if not source_url:
		return Response("Missing url", status_code=400)
	try:
		master = get_best_hls_url(source_url)
		r = _requests.get(master, timeout=20)
		if r.status_code != 200:
			return Response(f"Upstream error {r.status_code}", status_code=502)
		proxy_base = f"/streamlink/hls/segment?src={quote(master, safe='')}"
		rewritten = rewrite_hls_manifest(r.text, master, proxy_base)
		return Response(content=rewritten, status_code=200,
						media_type="application/vnd.apple.mpegurl",
						headers={"Cache-Control": "no-cache, no-store, must-revalidate"})
	except Exception as e:
		return Response(f"HLS error: {e}", status_code=502)


# ---- /streamlink/hls/segment ---------------------------------------------

@router.get("/streamlink/hls/segment")
async def streamlink_hls_segment(src: str = Query(""), u: str = Query("")):
	src = unquote(src.strip())
	u = unquote(u.strip())
	if not (src and u):
		return Response("Missing src/u", status_code=400)
	try:
		r = _requests.get(u, timeout=20, stream=True)
		ct = r.headers.get("Content-Type")
		if ct and "mpegurl" in ct:
			rewritten = rewrite_hls_manifest(r.text, u, f"/streamlink/hls/segment?src={src}")
			return Response(content=rewritten, status_code=200,
							media_type="application/vnd.apple.mpegurl",
							headers={"Cache-Control": "no-cache, no-store, must-revalidate"})

		resp_headers = {}
		if ct:
			resp_headers["Content-Type"] = ct
		for hdr in ["Content-Length", "Content-Range", "Accept-Ranges", "Cache-Control"]:
			if hdr in r.headers:
				resp_headers[hdr] = r.headers[hdr]

		return StreamingResponse(r.iter_content(chunk_size=1024 * 256),
								status_code=r.status_code, headers=resp_headers)
	except Exception as e:
		return Response(f"Segment error: {e}", status_code=502)
