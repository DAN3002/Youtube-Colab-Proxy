from typing import Tuple, Optional
import threading
import time

import portpicker
import uvicorn


def start_server_in_thread(app, host: str = "0.0.0.0", port: Optional[int] = None) -> Tuple[int, threading.Thread]:
	"""Start the given FastAPI app with uvicorn in a background thread, returning (port, thread)."""
	if port is None:
		port = portpicker.pick_unused_port()

	config = uvicorn.Config(app, host=host, port=port, log_level="warning")
	server = uvicorn.Server(config)

	thread = threading.Thread(target=server.run, daemon=True)
	thread.start()

	# Wait briefly for the server to start
	time.sleep(1.0)

	return port, thread
