"""Video stream proxy route – /stream

Resolves a YouTube video via yt-dlp and proxies the direct media bytes
back to the client, including Range support.
"""

import asyncio
from typing import Dict, Optional

import requests as _requests
from fastapi import APIRouter, Query, Request, Response
from fastapi.responses import StreamingResponse

from ..dependencies import YOUTUBE_ID_RE, normalize_youtube_url
from ...services.resolver import resolve_direct_media

router = APIRouter(tags=["stream"])


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
