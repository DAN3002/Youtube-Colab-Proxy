def get_public_proxy_url(port: int) -> str:
	"""Return the public Colab URL that maps to the given internal port."""
	from google.colab import output as colab_output

	return colab_output.eval_js(f"google.colab.kernel.proxyPort({port})")


def display_video_player(stream_url: str) -> None:
	"""Display an HTML5 video player pointing to the given stream URL."""
	from IPython.display import HTML, display

	html = f"""
	<div style="max-width: 780px">
		<video controls playsinline width="720" style="max-width:100%; outline:none">
			<source src="{stream_url}" type="video/mp4">
			Your browser does not support HTML5 video.
		</video>
		<div style="font:14px/1.5 system-ui,Segoe UI,Roboto">
			Streaming via Colab proxy. Seeking is supported (Range requests).
		</div>
	</div>
	"""
	display(HTML(html))


def display_app_link(app_url: str) -> None:
	"""Display a link to open the web app in Colab output."""
	from IPython.display import HTML, display

	display(HTML(f'<div style="font:14px system-ui"><a href="{app_url}/" target="_blank">Open YouTube Proxy App</a></div>')) 
