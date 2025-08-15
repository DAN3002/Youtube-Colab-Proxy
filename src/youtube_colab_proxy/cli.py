import sys


def main() -> int:
	"""Entry point for the console script."""
	from . import __version__
	print(f"youtube-colab-proxy {__version__}")
	return 0


if __name__ == "__main__":
	sys.exit(main()) 
