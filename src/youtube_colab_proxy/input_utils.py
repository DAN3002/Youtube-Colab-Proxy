import re

YOUTUBE_ID_RE = re.compile(r'^[A-Za-z0-9_-]{11}$')


def normalize_youtube_url(user_input: str) -> str:
	"""Normalize various user inputs into a standard YouTube watch URL.

	- Full URLs (watch, youtu.be, shorts) are normalized to watch URLs
	- Bare 11-char IDs are converted to watch URLs
	- Returns empty string if input cannot be normalized
	"""
	s = user_input.strip()

	# If it's already a URL, try to extract the v=... or the last path for youtu.be
	if s.startswith(("http://", "https://")):
		# youtu.be/<id>
		m = re.search(r'youtu\.be/([A-Za-z0-9_-]{11})', s)
		if m:
			return f"https://www.youtube.com/watch?v={m.group(1)}"
		# youtube.com/watch?v=<id>
		m = re.search(r'[?&]v=([A-Za-z0-9_-]{11})', s)
		if m:
			return f"https://www.youtube.com/watch?v={m.group(1)}"
		# shorts/<id> -> convert to watch URL
		m = re.search(r'/shorts/([A-Za-z0-9_-]{11})', s)
		if m:
			return f"https://www.youtube.com/watch?v={m.group(1)}"
		# If it's some other YT URL (playlist etc.), just return as-is
		return s

	# If it's a bare 11-char ID
	if YOUTUBE_ID_RE.match(s):
		return f"https://www.youtube.com/watch?v={s}"

	# Otherwise treat it as not-a-link
	return "" 
