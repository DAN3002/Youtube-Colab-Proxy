import os
from typing import Optional

from fastapi import FastAPI
from fastapi.staticfiles import StaticFiles

_THIS_DIR = os.path.dirname(os.path.abspath(__file__))
STATIC_DIR = os.path.join(_THIS_DIR, "static")
TEMPLATES_DIR = os.path.join(_THIS_DIR, "templates")


def create_app(cookie_file: Optional[str] = None) -> FastAPI:
	"""Create and configure the FastAPI application."""
	app = FastAPI(title="YouTube Proxy Player", docs_url=None, redoc_url=None)

	# Store config on app state
	app.state.cookie_file = cookie_file

	# Mount static files
	app.mount("/static", StaticFiles(directory=STATIC_DIR), name="static")

	# Register route modules
	from .routes.pages import router as pages_router
	from .routes.api import router as api_router
	from .routes.stream import router as stream_router
	from .routes.streamlink import router as streamlink_router

	app.include_router(pages_router)
	app.include_router(api_router, prefix="/api")
	app.include_router(stream_router)
	app.include_router(streamlink_router)

	return app
