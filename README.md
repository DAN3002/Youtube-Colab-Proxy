# YouTube Colab Proxy

A Python web application that provides a YouTube video streaming proxy with a built-in web player. Designed to work seamlessly in Google Colab environments while also supporting local development and deployment.

## Features

### 🎥 Video Streaming
- **Direct YouTube video streaming** through a proxy server
- **Progressive MP4 format** support (≤720p) with both audio and video
- **Range request support** for video seeking and partial content delivery
- **Automatic format selection** using yt-dlp for optimal compatibility

### 🔍 Search & Discovery
- **YouTube search** functionality with keyword-based video discovery
- **Playlist support** for YouTube playlists and channel videos
- **Paginated results** for efficient browsing

### 🛡️ Security & Configuration
- **Optional password protection** using SHA256 hashing
- **Cookie support** for accessing age-restricted or private content
- **Configurable geo-bypass** and language settings
- **Outbound proxy support** for network routing

## Installation

### From Source

```bash
# Clone the repository
git clone https://github.com/DAN3002/Youtube-Colab-Proxy.git
cd Youtube-Colab-Proxy

# Install in development mode
pip install -e .
```

### Using pip (when published)

```bash
pip install youtube-colab-proxy
```

## Quick Start

### Command Line Interface

```bash
# Start the web server
ycp --serve

# Specify custom host and port
ycp --serve --host 127.0.0.1 --port 8080

# Start with password protection
ycp --serve --password your_password

# Use YouTube cookies for private/age-restricted content
ycp --serve --cookies /path/to/cookies.txt

# Use raw cookie string
ycp --serve --cookies-str "session_token=abc123; other_cookie=xyz"
```


### Google Colab Usage

```python
# Install in Colab
!pip install youtube-colab-proxy

# Start the proxy server
import youtube_colab_proxy
url = youtube_colab_proxy.start()

# The app will automatically:
# 1. Start a Flask server
# 2. Create a public Colab proxy URL
# 3. Display a clickable link in the output
```

## Configuration

### Environment Variables

The application can be configured through constants in `src/youtube_colab_proxy/const.py`:

```python
# Pagination settings
PL_PAGE_SIZE = 8  # Number of items per page

# Security (set to enable password protection)
ADMIN_PASSWORD_SHA256 = "your_sha256_hash_here"

# Localization
YT_LANG = "en-US"  # Language preference
YT_GEO_BYPASS_COUNTRY = "US"  # Country for geo-bypass

# Network settings
OUTBOUND_PROXY = ""  # Optional proxy for outbound requests
```

### Password Protection

To enable password protection:

1. Generate a SHA256 hash of your password:
```python
import youtube_colab_proxy
hash_value = youtube_colab_proxy.hash_pass("your_password")
print(hash_value)
```

2. Set the hash in `const.py`:
```python
ADMIN_PASSWORD_SHA256 = "your_generated_hash"
```

3. Start the server with the password:
```bash
ycp --serve --password your_password
```

## API Endpoints

### Web Interface
- `GET /` - Main web application interface

### Video Operations
- `GET /stream?id={video_id}` - Stream YouTube video by ID
- `GET /stream?url={youtube_url}` - Stream YouTube video by URL

### Search & Discovery  
- `GET /api/search?q={query}&page={page}` - Search YouTube videos
- `GET /api/playlist?url={playlist_url}&page={page}` - Get playlist/channel videos
- `GET /api/thumb/{video_id}?q={quality}` - Get video thumbnail

## Dependencies

- **yt-dlp** - YouTube video extraction and metadata
- **Flask** - Web application framework
- **youtube-search-python** - YouTube search functionality  
- **portpicker** - Automatic port selection
- **requests** - HTTP client for proxy streaming

## Development

### Setup Development Environment

```bash
# Create virtual environment
python3 -m venv .venv
source .venv/bin/activate  # On Windows: .venv\Scripts\activate

# Install development dependencies
pip install -U pip setuptools wheel build pytest
pip install -e .
```

To run and test the application, you can use the following commands:
```bash
# Run the application
./run_ycp.sh
```

## Author

- [@DAN3002](https://github.com/DAN3002)

## License

Apache License 2.0 - see [LICENSE](LICENSE) file for details.

## Contributing

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes (`git commit -m 'Add amazing feature'`)
4. Push to the branch (`git push origin feature/amazing-feature`)
5. Open a Pull Request

## Disclaimer

This tool is for educational and legitimate use cases only. Please respect YouTube's Terms of Service and copyright laws. Users are responsible for ensuring their usage complies with applicable laws and regulations.
