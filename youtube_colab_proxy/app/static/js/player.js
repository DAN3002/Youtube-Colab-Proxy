/**
 * Video player logic – loaded on /watch pages only.
 * Handles: video playback, resolution switching, HLS, keyboard shortcuts,
 * player mode (normal/theater), and playlist auto-advance.
 */

let currentPlayerMode = 'normal';
let currentPlayingVideoId = null;

// ---------------------------------------------------------------------------
// Player mode (normal / theater)
// ---------------------------------------------------------------------------

const syncCommentsPanelHeight = () => {
	if (currentPlayerMode === 'theater') return;
	const panel = document.querySelector('#playerWrap .comments-panel');
	const videoBox = document.querySelector('#playerWrap .watch-player-pane .aspect-video');
	if (!(panel instanceof HTMLElement) || !(videoBox instanceof HTMLElement)) return;
	if (window.innerWidth <= 639) {
		panel.style.height = '';
		return;
	}
	const h = Math.round(videoBox.getBoundingClientRect().height || 0);
	if (h > 0) panel.style.height = `${h}px`;
};

window.addEventListener('resize', syncCommentsPanelHeight);

const setPlayerModeUI = (mode) => {
	$$('#playerModeSwitch .player-mode-btn').forEach((btn) => {
		btn.classList.toggle('is-active', btn.getAttribute('data-mode') === mode);
	});
};

const applyTheaterCommentsCollapse = () => {
	const body = document.body;
	if (!body) return;
	const app = loadAppSettings();
	const collapsed = !!app.theaterCommentsCollapsed;
	const inTheater = currentPlayerMode === 'theater';
	body.classList.toggle('theater-comments-collapsed', inTheater && collapsed);
	const btn = $('#theaterCommentsToggle');
	if (btn instanceof HTMLButtonElement) {
		btn.disabled = !inTheater;
		btn.setAttribute('aria-disabled', !inTheater ? 'true' : 'false');
		const pressed = inTheater && collapsed;
		btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
		btn.title = pressed ? 'Show comments in theater mode' : 'Collapse comments in theater mode';
		const label = btn.querySelector('span');
		if (label) label.textContent = pressed ? 'Show comments' : 'Hide comments';
	}
};

const setPlayerMode = (mode) => {
	const normalizedMode = mode === 'theater' ? 'theater' : 'normal';
	const body = document.body;
	if (!body) return;
	body.classList.toggle('player-mode-theater', normalizedMode === 'theater');
	currentPlayerMode = normalizedMode;
	setPlayerModeUI(normalizedMode);
	savePlayerMode(normalizedMode);
	applyTheaterCommentsCollapse();
	const panel = document.querySelector('#playerWrap .comments-panel');
	if (panel instanceof HTMLElement) panel.style.height = '';
	syncCommentsPanelHeight();
};

// ---------------------------------------------------------------------------
// Video playback
// ---------------------------------------------------------------------------

const setPlayer = (src, title, channel = '') => {
	const v = $('#player');
	const isHls = typeof src === 'string' && (src.includes('.m3u8') || src.includes('/streamlink/hls'));

	const resSel = $('#videoResolution');
	if (resSel) {
		hideEl(resSel);
		resSel.innerHTML = '';
	}

	if (v._errorHandler) {
		v.removeEventListener('error', v._errorHandler);
		v._errorHandler = null;
	}

	const errorHandler = (e) => {
		console.error('Video load error:', e);
		let errorMsg = 'Failed to load video. ';
		if (v.error) {
			switch (v.error.code) {
				case v.error.MEDIA_ERR_ABORTED: errorMsg += 'Video loading was aborted.'; break;
				case v.error.MEDIA_ERR_NETWORK: errorMsg += 'Network error occurred.'; break;
				case v.error.MEDIA_ERR_DECODE: errorMsg += 'Video format not supported.'; break;
				case v.error.MEDIA_ERR_SRC_NOT_SUPPORTED: errorMsg += 'Video source unavailable.'; break;
				default: errorMsg += 'Unknown error.';
			}
		}
		openModal(errorMsg);
	};

	v.addEventListener('error', errorHandler);
	v._errorHandler = errorHandler;

	if (isHls && window.Hls && Hls.isSupported()) {
		try {
			if (v._hls) { v._hls.destroy(); v._hls = null; }
			const hls = new Hls({ lowLatencyMode: true, enableWorker: true });
			hls.on(window.Hls.Events.ERROR, (event, data) => {
				if (data.fatal) {
					console.error('HLS fatal error:', data);
					openModal('Streaming error: ' + (data.type || 'Unknown'));
				}
			});
			hls.loadSource(src);
			hls.attachMedia(v);
			v._hls = hls;
		} catch (err) {
			console.error('HLS setup error:', err);
			openModal('Failed to initialize video player.');
			return;
		}
	} else {
		if (v._hls) { try { v._hls.destroy(); } catch {} v._hls = null; }
		v.src = src;
	}

	v.currentTime = 0;
	v.play().catch(() => {});

	$('#nowPlaying').textContent = title || '';
	$('#nowChannel').textContent = channel || '';
	$('#openStream').href = src;
	syncCommentsPanelHeight();
};

const playById = (id, title, channel = '') => {
	currentPlayingVideoId = id || null;
	const app = loadAppSettings();
	const h = Number(app.resolution || 0);
	const qs = h > 0 ? `&h=${h}` : '';
	const url = `/stream?id=${encodeURIComponent(id)}${qs}`;
	setPlayer(url, title, channel);

	// Fetch available resolutions
	fetch(`/api/formats?id=${encodeURIComponent(id)}`)
		.then(r => r.json())
		.then(data => {
			const sel = $('#videoResolution');
			if (!sel) return;
			const formats = (data && Array.isArray(data.formats)) ? data.formats : [];
			if (formats.length === 0) { hideEl(sel); return; }
			const cur = Number(loadAppSettings().resolution || 0);
			let html = `<option value="0">Auto</option>`;
			html += formats.map(f => `<option value="${f.height}">${f.label}</option>`).join('');
			sel.innerHTML = html;
			sel.value = String(cur > 0 ? cur : 0);
			showEl(sel);
			sel.onchange = () => {
				const newH = parseInt(sel.value, 10) || 0;
				saveAppSettings({ ...loadAppSettings(), resolution: newH });
				const qs2 = newH > 0 ? `&h=${newH}` : '';
				setPlayer(`/stream?id=${encodeURIComponent(id)}${qs2}`, title, channel);
			};
		})
		.catch(() => {});
};

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

document.addEventListener('keydown', (e) => {
	const v = $('#player');
	if (!v) return;
	if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
	const key = e.key;
	if (key === ' ' || key === 'k' || key === 'K') {
		e.preventDefault();
		if (v.paused) v.play().catch(() => {}); else v.pause();
	} else if (key === 'j' || key === 'J' || key === 'ArrowLeft') {
		e.preventDefault();
		try { v.currentTime = Math.max(0, (v.currentTime || 0) - 5); } catch {}
	} else if (key === 'l' || key === 'L' || key === 'ArrowRight') {
		e.preventDefault();
		try { v.currentTime = Math.max(0, (v.currentTime || 0) + 5); } catch {}
	} else if (key === 'f' || key === 'F') {
		e.preventDefault();
		if (document.fullscreenElement) {
			document.exitFullscreen();
		} else {
			v.requestFullscreen().catch(() => {});
		}
	}
});

// ---------------------------------------------------------------------------
// Video ended handler
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
	const v = $('#player');
	if (!v) return;
	v.addEventListener('ended', () => {
		const s = loadAppSettings();
		if (s.onEnd === 'loop') {
			try { v.currentTime = 0; v.play().catch(() => {}); } catch {}
			return;
		}
		if (s.onEnd === 'next') {
			// Try to find and navigate to next playlist item
			const nextLink = document.querySelector('.playlist-next-link');
			if (nextLink) {
				window.location.href = nextLink.href;
			}
		}
	});
});

// ---------------------------------------------------------------------------
// Init (called from watch.html)
// ---------------------------------------------------------------------------

function initPlayerPage(videoId, playlistId, playlistIndex) {
	// Set up player mode
	$$('#playerModeSwitch .player-mode-btn').forEach((btn) => {
		btn.addEventListener('click', () => {
			setPlayerMode(btn.getAttribute('data-mode') || 'normal');
		});
	});
	$('#theaterCommentsToggle')?.addEventListener('click', () => {
		if (currentPlayerMode !== 'theater') return;
		const app = loadAppSettings();
		saveAppSettings({ ...app, theaterCommentsCollapsed: !app.theaterCommentsCollapsed });
		applyTheaterCommentsCollapse();
		syncCommentsPanelHeight();
	});
	setPlayerMode(loadPlayerMode());

	// Init comments limit from settings
	const app = loadAppSettings();
	const commentsLimitEl = $('#commentsLimit');
	if (commentsLimitEl) {
		const allowed = [10, 20, 50, 70, 100];
		const limit = allowed.includes(Number(app.commentsLimit)) ? Number(app.commentsLimit) : 50;
		commentsLimitEl.value = String(limit);
	}
	applyTheaterCommentsCollapse();
	syncCommentsPanelHeight();

	// Start playing video
	if (videoId) {
		playById(videoId, '', '');

		// Load comments
		if (typeof loadCommentsForVideo === 'function') {
			loadCommentsForVideo(videoId);
		}

		// Fetch video info to get title/channel
		fetch(`/api/formats?id=${encodeURIComponent(videoId)}`)
			.catch(() => {});
	}
}
