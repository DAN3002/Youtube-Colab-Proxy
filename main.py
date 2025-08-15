# -*- coding: utf-8 -*-
"""
Flask YouTube Proxy + Mantine UI (single file)
- Search / Video URL / Playlist URL
- Stream via /stream (Range supported)
- Thumbnails proxied qua /api/thumb/<videoId>
- /api/search và /api/playlist trả 'thumb' để client dùng trực tiếp

Cài đặt:
  pip install yt-dlp youtubesearchpython flask requests portpicker

Chạy:
  python app.py
  -> Local: http://localhost:3000/
  -> Colab: hiện link "Open YouTube Proxy App"
"""
import re
import time
import json
import threading
from typing import Dict, Tuple, Optional

import requests
import yt_dlp
from youtubesearchpython import VideosSearch
from flask import Flask, request, jsonify, Response

try:
    import portpicker  # optional (Colab tiện)
except Exception:
    portpicker = None

# =========================
# Utils
# =========================
YOUTUBE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{11}$")

def normalize_youtube_url(user_input: str) -> str:
    s = (user_input or "").strip()
    if not s:
        return ""
    if s.startswith(("http://", "https://")):
        m = re.search(r"youtu\.be/([A-Za-z0-9_-]{11})", s)
        if m:
            return f"https://www.youtube.com/watch?v={m.group(1)}"
        m = re.search(r"[?&]v=([A-Za-z0-9_-]{11})", s)
        if m:
            return f"https://www.youtube.com/watch?v={m.group(1)}"
        m = re.search(r"/shorts/([A-Za-z0-9_-]{11})", s)
        if m:
            return f"https://www.youtube.com/watch?v={m.group(1)}"
        return s
    if YOUTUBE_ID_RE.match(s):
        return f"https://www.youtube.com/watch?v={s}"
    return ""

def pick_progressive_mp4(info_dict: dict) -> Optional[dict]:
    """Chọn progressive MP4 <=720p có audio+video."""
    fmts = info_dict.get("formats") or []
    candidates = []
    for f in fmts:
        if (
            f.get("ext") == "mp4"
            and f.get("vcodec") != "none"
            and f.get("acodec") != "none"
        ):
            height = f.get("height") or 0
            if height <= 720:
                candidates.append((height, f))
    if candidates:
        candidates.sort(key=lambda x: x[0], reverse=True)
        return candidates[0][1]
    return None

# =========================
# Streaming cache
# =========================
STREAM_CACHE: Dict[str, Dict[str, object]] = {}
CACHE_TTL_SEC = 20 * 60  # 20 phút

def resolve_direct_media(watch_url: str) -> Tuple[str, Dict[str, str]]:
    """Resolve watch URL -> direct media URL + headers (cache)."""
    now = time.time()
    key = watch_url
    cached = STREAM_CACHE.get(key)
    if cached and (now - float(cached.get("ts", 0))) < CACHE_TTL_SEC:
        return cached["direct_url"], cached.get("headers", {})  # type: ignore

    ydl_opts = {
        "quiet": True,
        "nocheckcertificate": True,
        "format": (
            "best[ext=mp4][height<=720][vcodec!=none][acodec!=none]/"
            "bestvideo[ext=mp4][height<=720][vcodec!=none]+bestaudio[acodec!=none]/"
            "best[height<=720]"
        ),
        "noplaylist": True,
    }
    with yt_dlp.YoutubeDL(ydl_opts) as ydl:
        info = ydl.extract_info(watch_url, download=False)

    direct_url = info.get("url")
    headers = dict(info.get("http_headers") or {})
    if not direct_url:
        chosen_fmt = pick_progressive_mp4(info)
        if chosen_fmt:
            direct_url = chosen_fmt.get("url")
            headers.update(chosen_fmt.get("http_headers") or {})

    if not direct_url:
        raise RuntimeError("No progressive MP4 (<=720p) found. Try another video.")

    STREAM_CACHE[key] = {"direct_url": direct_url, "headers": headers, "ts": now}
    return direct_url, headers

# =========================
# Flask app & APIs
# =========================
app = Flask(__name__)

# ------ THUMB (proxy ảnh) ------
def _pick_thumb_candidates(vid: str, pref: str = "hq"):
    order_map = {
        "max": ["maxresdefault.jpg", "sddefault.jpg", "hqdefault.jpg", "mqdefault.jpg", "default.jpg"],
        "sd":  ["sddefault.jpg", "hqdefault.jpg", "mqdefault.jpg", "default.jpg"],
        "hq":  ["hqdefault.jpg", "sddefault.jpg", "mqdefault.jpg", "default.jpg"],
        "mq":  ["mqdefault.jpg", "hqdefault.jpg", "sddefault.jpg", "default.jpg"],
        "def": ["default.jpg", "mqdefault.jpg", "hqdefault.jpg"],
    }
    return [f"https://i.ytimg.com/vi/{vid}/{path}" for path in order_map.get(pref, order_map["hq"])]

def _fetch_thumb_bytes(vid: str, pref: str = "hq"):
    for url in _pick_thumb_candidates(vid, pref):
        try:
            r = requests.get(url, timeout=10, headers={
                "User-Agent": "Mozilla/5.0",
                "Accept": "image/avif,image/webp,image/apng,image/*,*/*;q=0.8",
                "Referer": "https://www.youtube.com/",
            })
            if r.status_code == 200 and r.content:
                ctype = r.headers.get("Content-Type", "image/jpeg")
                return r.content, ctype
        except Exception:
            continue
    return None, None

@app.get("/api/thumb/<vid>")
def api_thumb(vid):
    if not YOUTUBE_ID_RE.match(vid):
        return Response("Invalid video id", status=400)
    pref = request.args.get("q", "hq")
    data, ctype = _fetch_thumb_bytes(vid, pref=pref)
    if not data:
        return Response("Thumbnail not found", status=404)
    resp = Response(data, status=200, mimetype=ctype or "image/jpeg")
    # Cache nhẹ ở client/CDN nếu muốn
    resp.headers["Cache-Control"] = "public, max-age=3600"
    return resp

# ------ SEARCH ------
@app.get("/api/search")
def api_search():
    q = (request.args.get("q") or "").strip()
    limit = request.args.get("limit", "15")
    try:
        limit = max(1, min(int(limit), 50))
    except Exception:
        limit = 15

    if not q:
        return jsonify({"items": []})

    try:
        items = []
        results = VideosSearch(q, limit=limit).result().get("result", [])
        for v in results:
            vid = v.get("id") or ""
            title = v.get("title") or ""
            dur = v.get("duration") or ""
            ch = (v.get("channel") or {}).get("name") or ""
            if not vid or not YOUTUBE_ID_RE.match(vid):
                continue
            items.append({
                "id": vid,
                "title": title,
                "duration": dur,
                "channel": ch,
                "watchUrl": f"https://www.youtube.com/watch?v={vid}",
                "stream": f"/stream?id={vid}",
                "thumb": f"/api/thumb/{vid}?q=hq",
            })
        return jsonify({"items": items})
    except Exception as e:
        return jsonify({"error": str(e), "items": []}), 500

# ------ PLAYLIST ------
@app.get("/api/playlist")
def api_playlist():
    raw_url = (request.args.get("url") or "").strip()
    if not raw_url:
        return jsonify({"items": [], "error": "Missing url"}), 400

    ydl_opts = {"quiet": True, "extract_flat": True, "skip_download": True}
    try:
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(raw_url, download=False)

        entries = info.get("entries") or []
        items = []
        for e in entries:
            vid = (e.get("id") or e.get("url") or "").strip()
            title = (e.get("title") or "").strip()
            if not (vid and YOUTUBE_ID_RE.match(vid)):
                continue
            items.append({
                "id": vid,
                "title": title or "(no title)",
                "watchUrl": f"https://www.youtube.com/watch?v={vid}",
                "stream": f"/stream?id={vid}",
                "thumb": f"/api/thumb/{vid}?q=hq",
            })
        return jsonify({"items": items})
    except Exception as e:
        return jsonify({"items": [], "error": str(e)}), 500

# ------ STREAM ------
@app.get("/stream")
def stream():
    url_param = (request.args.get("url") or "").strip()
    id_param = (request.args.get("id") or "").strip()

    if url_param:
        watch_url = normalize_youtube_url(url_param)
    elif id_param and YOUTUBE_ID_RE.match(id_param):
        watch_url = f"https://www.youtube.com/watch?v={id_param}"
    else:
        return Response("Missing or invalid url/id", status=400)

    try:
        direct_url, ydl_headers = resolve_direct_media(watch_url)
    except Exception as e:
        return Response(f"Failed to resolve media: {e}", status=502)

    prox_headers: Dict[str, str] = {}
    for k in [
        "User-Agent",
        "Accept",
        "Accept-Language",
        "Sec-Fetch-Mode",
        "Referer",
        "Origin",
        "Cookie",
    ]:
        if k in ydl_headers:
            prox_headers[k] = ydl_headers[k]

    rng = request.headers.get("Range")
    if rng:
        prox_headers["Range"] = rng

    r = requests.get(direct_url, headers=prox_headers, stream=True, timeout=30)
    resp = Response(r.iter_content(chunk_size=1024 * 1024), status=r.status_code)
    resp.headers["Content-Type"] = r.headers.get("Content-Type", "video/mp4")
    for h in [
        "Accept-Ranges",
        "Content-Length",
        "Content-Range",
        "Content-Disposition",
        "ETag",
        "Last-Modified",
        "Cache-Control",
    ]:
        if h in r.headers:
            resp.headers[h] = r.headers[h]
    return resp

# =========================
# Frontend (HTML + Mantine CSS)
# =========================
HTML_PAGE = r"""
<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>YouTube Proxy Player</title>
    <!-- Mantine styles -->
    <link rel="stylesheet" href="https://unpkg.com/@mantine/core@7.17.8/styles.css" />
    <style>
      body { background: #0f1216; color: #eaeef2; font-family: system-ui,Segoe UI,Roboto,Inter,sans-serif; }
      a { color: inherit; }
      .wrap { max-width: 1100px; margin: 24px auto; padding: 0 16px; }
      .tabs { display: flex; gap: 8px; margin: 16px 0; flex-wrap: wrap; }
      .tab { padding: 8px 12px; border-radius: 10px; border: 1px solid #2a3140; cursor: pointer; }
      .tab.active { background: #1d2430; border-color: #3a4458; }
      .row { display: flex; gap: 8px; align-items: center; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(220px, 1fr)); gap: 16px; }
      .card { background: #171b21; border: 1px solid #262b36; border-radius: 14px; padding: 12px; cursor: pointer; }
      .card:hover { outline: 2px solid #2e7dff55; }
      .thumb { aspect-ratio: 16/9; width: 100%; object-fit: cover; border-radius: 8px; background:#0b0e12; }
      .muted { opacity: .75; font-size: 12px; }
      input[type=text] { width: 100%; padding: 10px 12px; border-radius: 10px; border: 1px solid #2a3140; background: #0f141b; color: #eaeef2; }
      button { padding: 10px 14px; border-radius: 10px; border: 1px solid #2a3140; background: #1a2230; color: #eaeef2; cursor: pointer; }
      button:hover { background: #223044; }
      .player { width: 100%; max-width: 960px; margin: 8px auto 0; display: block; }
      .pill { background: #23304a; border-radius: 999px; padding: 2px 8px; font-size: 12px; }
    </style>
  </head>
  <body>
    <div class="wrap">
      <h1 style="margin: 8px 0 0; font-weight: 700;">YouTube Proxy Player</h1>
      <div class="muted" style="margin-bottom: 6px;">Search hoặc dán video/playlist URL. Bấm vào card để phát qua proxy (seek OK).</div>

      <div class="tabs" id="tabs">
        <div class="tab active" data-tab="search">Search</div>
        <div class="tab" data-tab="video">Video URL</div>
        <div class="tab" data-tab="playlist">Playlist URL</div>
      </div>

      <div id="panel-search">
        <div class="row">
          <input id="q" type="text" placeholder="Search YouTube (vd: lo-fi hip hop)" />
          <button id="btnSearch">Search</button>
        </div>
        <div id="results" class="grid" style="margin-top: 14px;"></div>
      </div>

      <div id="panel-video" style="display:none;">
        <div class="row">
          <input id="videoUrl" type="text" placeholder="Paste video URL hoặc 11-char ID" />
          <button id="btnPlayUrl">Play</button>
        </div>
      </div>

      <div id="panel-playlist" style="display:none;">
        <div class="row">
          <input id="playlistUrl" type="text" placeholder="Paste playlist URL" />
          <button id="btnLoadList">Load playlist</button>
        </div>
        <div id="plist" class="grid" style="margin-top: 14px;"></div>
      </div>

      <div id="playerWrap" style="margin-top: 18px; display:none;">
        <div class="row" style="justify-content: space-between;">
          <div id="nowPlaying" class="muted"></div>
          <a id="openStream" class="pill" href="#" target="_blank" rel="noopener">Open stream</a>
        </div>
        <video id="player" class="player" controls playsinline preload="metadata"></video>
      </div>
    </div>

    <script>
      const $ = (sel) => document.querySelector(sel);
      const $$ = (sel) => Array.from(document.querySelectorAll(sel));

      // Tabs
      $$(".tab").forEach((t) => {
        t.addEventListener("click", () => {
          $$(".tab").forEach((x) => x.classList.remove("active"));
          t.classList.add("active");
          const tab = t.dataset.tab;
          $("#panel-search").style.display = tab === "search" ? "block" : "none";
          $("#panel-video").style.display = tab === "video" ? "block" : "none";
          $("#panel-playlist").style.display = tab === "playlist" ? "block" : "none";
        });
      });

      // Render cards with backend thumb
      const renderCards = (mountNode, items) => {
        mountNode.innerHTML = items.map((v) => `
          <div class="card" data-id="${v.id}" data-title="${encodeURIComponent(v.title)}">
            <img class="thumb" loading="lazy" src="${v.thumb}" alt="${v.title}" />
            <div style="margin-top:8px; font-weight:600;">${v.title}</div>
            <div class="muted">${v.channel || ""}</div>
            <div class="muted">${v.duration || ""}</div>
          </div>
        `).join("");
        mountNode.querySelectorAll('.card').forEach((el) => {
          el.addEventListener('click', () => {
            const id = el.getAttribute('data-id');
            const title = decodeURIComponent(el.getAttribute('data-title') || '');
            playById(id, title);
          });
        });
      };

      // Search
      const doSearch = async () => {
        const q = $('#q').value.trim();
        if (!q) return;
        $('#results').innerHTML = '<div class="muted">Searching…</div>';
        try {
          const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
          const j = await r.json();
          renderCards($('#results'), j.items || []);
        } catch (e) {
          $('#results').innerHTML = `<div class="muted">Search failed: ${e}</div>`;
        }
      };
      $('#btnSearch').addEventListener('click', doSearch);
      $('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') doSearch(); });

      // Video URL
      const playUrl = () => {
        const u = $('#videoUrl').value.trim();
        if (!u) return;
        setPlayer(`/stream?url=${encodeURIComponent(u)}`, 'Custom video');
      };
      $('#btnPlayUrl').addEventListener('click', playUrl);
      $('#videoUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') playUrl(); });

      // Playlist
      const loadPlaylist = async () => {
        const u = $('#playlistUrl').value.trim();
        if (!u) return;
        $('#plist').innerHTML = '<div class="muted">Loading playlist…</div>';
        try {
          const r = await fetch(`/api/playlist?url=${encodeURIComponent(u)}`);
          const j = await r.json();
          if (j.error) {
            $('#plist').innerHTML = `<div class="muted">${j.error}</div>`;
          } else {
            renderCards($('#plist'), j.items || []);
          }
        } catch (e) {
          $('#plist').innerHTML = `<div class="muted">Failed: ${e}</div>`;
        }
      };
      $('#btnLoadList').addEventListener('click', loadPlaylist);
      $('#playlistUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadPlaylist(); });

      // Player helpers
      const setPlayer = (src, title) => {
        const v = $('#player');
        v.src = src;
        v.currentTime = 0;
        v.play().catch(() => {/* user gesture may be required */});
        $('#playerWrap').style.display = 'block';
        $('#nowPlaying').textContent = title || '';
        $('#openStream').href = src;
      };
      const playById = (id, title) => setPlayer(`/stream?id=${encodeURIComponent(id)}`, title);
    </script>
  </body>
</html>
"""

@app.get("/")
def index():
    return HTML_PAGE

# =========================
# Entrypoint (Colab-friendly)
# =========================
if __name__ == "__main__":
    # Start Flask
    if portpicker:
        try:
            port = portpicker.pick_unused_port()
        except Exception:
            port = 3000
    else:
        port = 3000

    threading.Thread(
        target=lambda: app.run(host="0.0.0.0", port=port, debug=False, use_reloader=False),
        daemon=True,
    ).start()

    # Colab proxy URL (nếu có)
    try:
        from google.colab import output as colab_output  # type: ignore
        from IPython.display import HTML, display  # type: ignore
        proxy_url = colab_output.eval_js(f"google.colab.kernel.proxyPort({port})")
        display(HTML(f'<div style="font:14px system-ui"><a href="{proxy_url}/" target="_blank">Open YouTube Proxy App</a></div>'))
        print("App URL:", proxy_url + "/")
    except Exception:
        print(f"Open http://localhost:{port}/ in your browser")
