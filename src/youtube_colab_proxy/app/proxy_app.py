from typing import Dict

import requests
from flask import Flask, Response, request


def create_proxy_app(direct_url: str, headers: Dict[str, str]) -> Flask:
	"""Create a Flask app that proxies the given direct media URL with Range support."""
	app = Flask(__name__)

	@app.route("/stream")
	def stream() -> Response:
		range_header = request.headers.get("Range")
		proxied_headers = dict(headers) if headers else {}
		if range_header:
			proxied_headers["Range"] = range_header

		r = requests.get(direct_url, headers=proxied_headers, stream=True, timeout=30)
		resp = Response(r.iter_content(chunk_size=1024 * 1024), status=r.status_code)
		resp.headers["Content-Type"] = r.headers.get("Content-Type", "video/mp4")
		for h in [
			"Accept-Ranges",
			"Content-Length",
			"Content-Range",
			"Content-Disposition",
		]:
			if h in r.headers:
				resp.headers[h] = r.headers[h]
		return resp

	return app 
