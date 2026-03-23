<p align="center">
  <img src="https://img.shields.io/pypi/v/youtube-colab-proxy?color=red&label=PyPI" alt="PyPI version" />
  <img src="https://img.shields.io/pypi/pyversions/youtube-colab-proxy" alt="Python" />
  <img src="https://img.shields.io/github/license/DAN3002/Youtube-Colab-Proxy" alt="License" />
  <img src="https://img.shields.io/github/stars/DAN3002/Youtube-Colab-Proxy?style=flat" alt="Stars" />
</p>

# YouTube Colab Proxy

A feature-rich YouTube streaming proxy with a built-in web player. Watch videos, browse channels, explore playlists, and read comments — all through a clean, YouTube-inspired dark UI. Designed for **Google Colab** but works anywhere Python runs.

## ✨ Features

### Search & Discovery
- **YouTube search** with paginated results
- **Channel pages** — Videos tab, Playlists tab, and in-channel search
- **Channel banners & avatars** proxied for privacy
- **Playlist viewer** with numbered tracks and channel links
- **Recommended videos** sidebar on the watch page
- **Watch history** persisted in the browser

### Comments
- **Top-level comments** with sort (Top / Newest) and adjustable limit
- **Lazy-loaded replies** — click to expand, no upfront cost
- **Pinned & hearted badges**, relative timestamps, avatars

### Infrastructure
- **FastAPI + Uvicorn** — async, fast, production-ready
- **In-memory TTL caching** — streams (20 min), comments (10 min), streamlink (5 min)
- **Image proxy** — thumbnails and avatars routed through the server (no CORS, no tracking)
- **Cookie support** — file, raw string, or browser import for age-restricted / private content
- **Password protection** via SHA256 gate
- **Google Colab integration** — auto-detects Colab, generates public proxy URL

## 📦 Installation

### From PyPI

```bash
pip install youtube-colab-proxy
```

### From Source

```bash
git clone https://github.com/DAN3002/Youtube-Colab-Proxy.git
cd Youtube-Colab-Proxy
pip install -e .
```

> **Requirement:** A JavaScript runtime (`node`, `deno`, or `bun`) is needed by [yt-dlp](https://github.com/yt-dlp/yt-dlp) for full YouTube extraction. Install one before running.

## 🚀 Quick Start

### CLI

```bash
# Start the server
ycp --serve

# Custom host and port
ycp --serve --host 0.0.0.0 --port 8080

# With password protection
ycp --serve --password my_secret

# With cookies (age-restricted / private videos)
ycp --serve --cookies /path/to/cookies.txt
ycp --serve --cookies-str "SID=abc; HSID=xyz"
ycp --serve --cookies-from-browser chrome
```

### Google Colab

**Cell 1** — Install:

```bash
!pip install youtube-colab-proxy
!apt-get update -qq && apt-get install -y -qq nodejs
```

**Cell 2** — Run:

```python
import youtube_colab_proxy
url = youtube_colab_proxy.start()
# → Opens a clickable public URL in the output
```

With cookies:

```python
url = youtube_colab_proxy.start(cookies_str="YOUR_COOKIE_STRING")
```

> **Note:** `apt-get install nodejs` provides the JS runtime that yt-dlp needs. Without it, some video formats may be missing.

## ⚙️ Configuration

Edit `youtube_colab_proxy/const.py`:

```python
PL_PAGE_SIZE = 8                    # Items per page
ADMIN_PASSWORD_SHA256 = "..."       # SHA256 hash (empty = no password)
YT_LANG = "en-US"                   # Accept-Language for yt-dlp
YT_GEO_BYPASS_COUNTRY = "US"       # Geo-bypass country code
OUTBOUND_PROXY = ""                 # Optional HTTP/SOCKS proxy
```

### Password Protection

```python
import youtube_colab_proxy
print(youtube_colab_proxy.hash_pass("my_password"))
# → paste the hash into const.py as ADMIN_PASSWORD_SHA256
```

Then start with:

```bash
ycp --serve --password my_password
```

## 🛠️ Development

```bash
# Clone & setup
git clone https://github.com/DAN3002/Youtube-Colab-Proxy.git
cd Youtube-Colab-Proxy
python3 -m venv .venv && source .venv/bin/activate
pip install -e .

# Run (auto-creates venv if needed)
./run_ycp.sh
```

### Tech Stack

| Layer | Technology |
|-------|-----------|
| Backend | [FastAPI](https://fastapi.tiangolo.com/) + [Uvicorn](https://www.uvicorn.org/) |
| Extraction | [yt-dlp](https://github.com/yt-dlp/yt-dlp) + [yt-dlp-ejs](https://github.com/nicholasgasior/yt-dlp-ejs) |
| Live Streams | [Streamlink](https://streamlink.github.io/) |
| Frontend | [Tailwind CSS](https://tailwindcss.com/) (CDN) + Vanilla JS |
| Templating | [Jinja2](https://jinja.palletsprojects.com/) |
| Video Playback | [hls.js](https://github.com/video-dev/hls.js/) |
| Icons | [Font Awesome 6](https://fontawesome.com/) |

## 📄 License

[Apache License 2.0](LICENSE)

## 🤝 Contributing

1. Fork the repo
2. Create a feature branch (`git checkout -b feature/my-feature`)
3. Commit your changes (`git commit -m 'Add my feature'`)
4. Push (`git push origin feature/my-feature`)
5. Open a Pull Request

## ⚠️ Disclaimer

This project is for **educational and community purposes only**. It is not intended to violate any company's policies or applicable laws. Users are responsible for ensuring their usage complies with YouTube's Terms of Service and local regulations.

---

<p align="center">
  Made by <a href="https://github.com/DAN3002">@DAN3002</a> · Powered by <a href="https://github.com/yt-dlp/yt-dlp">yt-dlp</a>
</p>
