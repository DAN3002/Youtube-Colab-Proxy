from typing import Tuple, Optional
import threading

import portpicker


def start_flask_in_thread(app, host: str = "0.0.0.0", port: Optional[int] = None) -> Tuple[int, threading.Thread]:
	"""Start the given Flask app in a background thread, returning (port, thread)."""
	if port is None:
		port = portpicker.pick_unused_port()

	thread = threading.Thread(
		target=lambda: app.run(host=host, port=port, debug=False, use_reloader=False),
		daemon=True,
	)
	thread.start()
	return port, thread 
