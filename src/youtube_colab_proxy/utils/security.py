import hashlib


def hash_pass(password: str) -> str:
	"""Return the SHA256 hex digest for the given password string.

	The password is encoded as UTF-8 before hashing.
	"""
	return hashlib.sha256((password or "").encode("utf-8")).hexdigest() 
