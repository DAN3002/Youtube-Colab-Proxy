from typing import Optional, Tuple

from .app.server import start_flask_in_thread
from .integrations.colab import get_public_proxy_url, display_app_link
from .app import create_app as _create_app


def start(host: str = "0.0.0.0", port: Optional[int] = None, password: Optional[str] = None, cookie_file: Optional[str] = None, cookies_str: Optional[str] = None, cookies_from_browser: Optional[str] = None, cookies_browser_profile: Optional[str] = None) -> str:
	"""Start the YouTube Proxy web app and return its base URL.

	On Colab, prints and displays a clickable link via output widget.
	Locally, prints localhost URL.
	"""
	# Optional password gate using SHA256 compare to ADMIN_PASSWORD_SHA256 in const.py
	from . import const as _const
	if getattr(_const, "ADMIN_PASSWORD_SHA256", ""):
		import hashlib
		pwd = (password or "").encode("utf-8")
		if hashlib.sha256(pwd).hexdigest() != _const.ADMIN_PASSWORD_SHA256:
			raise PermissionError("Invalid password")

	app = _create_app(cookie_file=cookie_file)
	# Pass cookie_file and cookies_str to resolver layer
	from .services import resolver as _resolver
	_resolver.set_cookie_file(cookie_file)
	_resolver.set_cookies_str(cookies_str)
	# New: pass cookies-from-browser preference
	try:
		_resolver.set_cookies_from_browser(cookies_from_browser, cookies_browser_profile)
	except Exception:
		# Non-fatal: continue without browser cookies
		pass
	chosen_port, _ = start_flask_in_thread(app, host=host, port=port)

	# Try Colab proxy; if unavailable, fallback to localhost
	try:
		base_url = get_public_proxy_url(chosen_port)
		print("App URL:", base_url + "/")
		# try:
		# 	display_app_link(base_url)
		# except Exception:
		# 	pass
		return base_url
	except Exception:
		local_url = f"http://localhost:{chosen_port}"
		print("Open", local_url + "/", "in your browser")
		return local_url 
