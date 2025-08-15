from typing import List, Dict, Any


def search_videos(keyword: str, limit: int = 10) -> List[Dict[str, Any]]:
	"""Search YouTube and return raw results from youtubesearchpython.
	Only lightweight fields are used by callers: title, duration, channel.name, link.
	"""
	from youtubesearchpython import VideosSearch

	results = VideosSearch(keyword, limit=limit).result().get("result", [])
	return results 
