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
	args = parser.parse_args()

	if args.serve:
		from .core import start
		url = start(host=args.host, port=args.port, password=args.password)
		print(f"Serving at {url}/")
		return 0

	print(f"youtube-colab-proxy {__version__}")
	return 0


if __name__ == "__main__":
	sys.exit(main()) 
