import sys
import argparse


def main() -> int:
	"""Entry point for the console script."""
	from . import __version__

	parser = argparse.ArgumentParser(prog="ycp", description="YouTube Colab Proxy")
	parser.add_argument("--serve", action="store_true", help="Start the web app server")
	parser.add_argument("--host", default="0.0.0.0", help="Listen host (default: 0.0.0.0)")
	parser.add_argument("--port", type=int, default=None, help="Listen port (default: auto)")
	parser.add_argument("--password", default=None, help="Password if ADMIN_PASSWORD_SHA256 is set")
	parser.add_argument("--cookies", dest="cookie_file", default=None, help="Path to YouTube cookies.txt for yt-dlp")
	parser.add_argument("--cookies-str", dest="cookies_str", default=None, help="Raw Cookie header string, e.g. 'A=1; B=2' (overrides file)")
	parser.add_argument("--cookies-from-browser", dest="cookies_from_browser", default=None, choices=["chrome", "chromium", "edge", "brave", "vivaldi", "opera"], help="Import cookies from a local browser (uses yt-dlp cookiesfrombrowser)")
	parser.add_argument("--cookies-browser-profile", dest="cookies_browser_profile", default=None, help="Browser profile name/directory for cookiesfrombrowser")
	args = parser.parse_args()

	if args.serve:
		from .core import start
		url = start(host=args.host, port=args.port, password=args.password, cookie_file=args.cookie_file, cookies_str=args.cookies_str, cookies_from_browser=args.cookies_from_browser, cookies_browser_profile=args.cookies_browser_profile)
		print(f"Serving at {url}/")
		return 0

	print(f"youtube-colab-proxy {__version__}")
	return 0


if __name__ == "__main__":
	sys.exit(main()) 
