"""Video stream proxy route – /stream

Resolves a YouTube video via yt-dlp and proxies the direct media bytes
back to the client, including Range support.

Supports two modes:
1. Remote URL proxy – fetches bytes from YouTube's CDN and relays them
2. Local merged file – serves a pre-merged mp4 file (video+audio via ffmpeg)
"""

import asyncio
import os
from typing import Dict, Optional

import requests as _requests
from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import StreamingResponse

from ..dependencies import YOUTUBE_ID_RE, normalize_youtube_url
from ...services.resolver import resolve_direct_media

router = APIRouter(tags=["stream"])


def _serve_local_file(file_path: str, request: Request) -> Response:
	"""Serve a local file with Range support for seeking."""
	if not os.path.exists(file_path):
		return Response("Merged file not found", status_code=404)

	file_size = os.path.getsize(file_path)
	rng = request.headers.get("Range")

	if rng:
		# Parse Range header: bytes=start-end
		try:
			range_spec = rng.replace("bytes=", "")
			parts = range_spec.split("-")
			start = int(parts[0]) if parts[0] else 0
			end = int(parts[1]) if parts[1] else file_size - 1
		except (ValueError, IndexError):
			start = 0
			end = file_size - 1

		start = max(0, min(start, file_size - 1))
		end = min(end, file_size - 1)
		content_length = end - start + 1

		def _iter_range():
			chunk_size = 1024 * 1024  # 1MB chunks
			with open(file_path, "rb") as f:
				f.seek(start)
				remaining = content_length
				while remaining > 0:
					read_size = min(chunk_size, remaining)
					data = f.read(read_size)
					if not data:
						break
					remaining -= len(data)
					yield data

		return StreamingResponse(
			_iter_range(),
			status_code=206,
			headers={
				"Content-Type": "video/mp4",
				"Content-Length": str(content_length),
				"Content-Range": f"bytes {start}-{end}/{file_size}",
				"Accept-Ranges": "bytes",
				"Cache-Control": "public, max-age=600",
			},
			media_type="video/mp4",
		)
	else:
		# Full file response
		def _iter_full():
			chunk_size = 1024 * 1024
			with open(file_path, "rb") as f:
				while True:
					data = f.read(chunk_size)
					if not data:
						break
					yield data

		return StreamingResponse(
			_iter_full(),
			status_code=200,
			headers={
				"Content-Type": "video/mp4",
				"Content-Length": str(file_size),
				"Accept-Ranges": "bytes",
				"Cache-Control": "public, max-age=600",
			},
			media_type="video/mp4",
		)


@router.get("/stream")
async def stream(
	request: Request,
	url: str = Query(""),
	id: str = Query(""),
	h: Optional[int] = Query(None),
):
	url_param = url.strip()
	id_param = id.strip()
	if url_param:
		watch_url = normalize_youtube_url(url_param)
	elif id_param and YOUTUBE_ID_RE.match(id_param):
		watch_url = f"https://www.youtube.com/watch?v={id_param}"
	else:
		return Response("Missing or invalid url/id", status_code=400)

	try:
		max_h = int(h) if h is not None else None
	except Exception:
		max_h = None

	try:
		direct_url, ydl_headers = await asyncio.to_thread(resolve_direct_media, watch_url, max_h or 10**9)
	except Exception as e:
		return Response(f"Failed to resolve media: {e}", status_code=502)

	# ---- Local merged file (from ffmpeg merge) ----
	if isinstance(direct_url, str) and direct_url.startswith("file://"):
		file_path = direct_url[7:]  # strip "file://"
		return _serve_local_file(file_path, request)

	# ---- Remote URL proxy ----
	prox_headers: Dict[str, str] = {}
	for k in ["User-Agent", "Accept", "Accept-Language", "Sec-Fetch-Mode", "Referer", "Origin", "Cookie"]:
		if k in ydl_headers:
			prox_headers[k] = ydl_headers[k]
	if "Referer" not in prox_headers:
		prox_headers["Referer"] = "https://www.youtube.com/"
	if "Origin" not in prox_headers:
		prox_headers["Origin"] = "https://www.youtube.com"

	rng = request.headers.get("Range")
	if rng:
		prox_headers["Range"] = rng

	r = await asyncio.to_thread(_requests.get, direct_url, headers=prox_headers, stream=True, timeout=30)

	resp_headers: Dict[str, str] = {
		"Content-Type": r.headers.get("Content-Type", "video/mp4"),
	}
	for hdr in ["Accept-Ranges", "Content-Length", "Content-Range", "Content-Disposition", "ETag", "Last-Modified", "Cache-Control"]:
		if hdr in r.headers:
			resp_headers[hdr] = r.headers[hdr]

	return StreamingResponse(
		r.iter_content(chunk_size=1024 * 1024),
		status_code=r.status_code,
		headers=resp_headers,
		media_type=resp_headers.get("Content-Type", "video/mp4"),
	)
