/**
 * Shared utility functions used across all pages.
 */

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// ---------------------------------------------------------------------------
// Cross-subdomain cookie helpers (for *.prod.colab.dev)
// ---------------------------------------------------------------------------

const _getSharedCookieDomain = () => {
	try {
		const h = location.hostname || '';
		if (h.endsWith('.prod.colab.dev')) return '.prod.colab.dev';
	} catch {}
	return null;
};

const _setCookie = (name, value, days = 365) => {
	try {
		const d = new Date();
		d.setTime(d.getTime() + (days * 24 * 60 * 60 * 1000));
		const expires = '; expires=' + d.toUTCString();
		const domain = _getSharedCookieDomain();
		document.cookie = name + '=' + encodeURIComponent(value) + expires + '; path=/' + (domain ? '; domain=' + domain : '');
	} catch {}
};

const _getCookie = (name) => {
	try {
		const cname = name + '=';
		const ca = document.cookie.split(';');
		for (let i = 0; i < ca.length; i++) {
			let c = ca[i];
			while (c.charAt(0) === ' ') c = c.substring(1);
			if (c.indexOf(cname) === 0) return decodeURIComponent(c.substring(cname.length, c.length));
		}
	} catch {}
	return null;
};

// ---------------------------------------------------------------------------
// App Settings (persisted to localStorage + cookie)
// ---------------------------------------------------------------------------

const APP_SETTINGS_KEY = 'ycp_app_settings_v3';
const defaultAppSettings = { onEnd: 'stop', resolution: 0, commentsLimit: 20, theaterCommentsCollapsed: false, loopVideo: false };

const loadAppSettings = () => {
	try {
		const raw = localStorage.getItem(APP_SETTINGS_KEY);
		if (raw) return { ...defaultAppSettings, ...JSON.parse(raw) };
	} catch {}
	try {
		const c = _getCookie(APP_SETTINGS_KEY);
		if (c) return { ...defaultAppSettings, ...JSON.parse(c) };
	} catch {}
	return { ...defaultAppSettings };
};

const saveAppSettings = (s) => {
	const payload = JSON.stringify({ ...defaultAppSettings, ...(s || {}) });
	try { localStorage.setItem(APP_SETTINGS_KEY, payload); } catch {}
	_setCookie(APP_SETTINGS_KEY, payload, 365);
};

// ---------------------------------------------------------------------------
// Player mode persistence
// ---------------------------------------------------------------------------

const PLAYER_MODE_KEY = 'ycp_player_mode_v1';

const loadPlayerMode = () => {
	try {
		const raw = localStorage.getItem(PLAYER_MODE_KEY);
		if (raw === 'theater' || raw === 'normal') return raw;
	} catch {}
	try {
		const c = _getCookie(PLAYER_MODE_KEY);
		if (c === 'theater' || c === 'normal') return c;
	} catch {}
	return 'normal';
};

const savePlayerMode = (mode) => {
	if (mode !== 'theater' && mode !== 'normal') return;
	try { localStorage.setItem(PLAYER_MODE_KEY, mode); } catch {}
	_setCookie(PLAYER_MODE_KEY, mode, 365);
};

// ---------------------------------------------------------------------------
// UI helpers
// ---------------------------------------------------------------------------

const showEl = (el) => { if (el) el.classList.remove('hidden'); };
const hideEl = (el) => { if (el) el.classList.add('hidden'); };

const showModal = (el) => {
	if (!el) return;
	el.classList.remove('hidden');
	el.classList.add('flex');
};
const hideModal = (el) => {
	if (!el) return;
	el.classList.add('hidden');
	el.classList.remove('flex');
};

const escapeHtml = (s) => String(s || '')
	.replace(/&/g, '&amp;')
	.replace(/</g, '&lt;')
	.replace(/>/g, '&gt;')
	.replace(/"/g, '&quot;')
	.replace(/'/g, '&#39;');

const formatRelativeTime = (ts) => {
	const n = Number(ts);
	if (!Number.isFinite(n) || n <= 0) return '';
	const now = Math.floor(Date.now() / 1000);
	const d = Math.max(0, now - n);
	if (d < 60) return 'just now';
	if (d < 3600) return `${Math.floor(d / 60)}m ago`;
	if (d < 86400) return `${Math.floor(d / 3600)}h ago`;
	if (d < 86400 * 30) return `${Math.floor(d / 86400)}d ago`;
	if (d < 86400 * 365) return `${Math.floor(d / (86400 * 30))}mo ago`;
	return `${Math.floor(d / (86400 * 365))}y ago`;
};

const formatDuration = (d) => {
	if (d == null || d === '') return '';
	if (typeof d === 'string') {
		const s = d.trim();
		if (/^\d+$/.test(s)) {
			d = parseInt(s, 10);
		} else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
			return s;
		} else {
			const n = Number(s);
			if (Number.isFinite(n)) d = n; else return s;
		}
	}
	const sec = Number(d) || 0;
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = Math.floor(sec % 60);
	const pad = (x) => String(x).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

// ---------------------------------------------------------------------------
// Toast Notifications
// ---------------------------------------------------------------------------

const showToast = (msg, duration = 3000) => {
	const container = $('#toastContainer');
	if (!container) return;
	const toast = document.createElement('div');
	toast.className = 'toast';
	toast.textContent = msg;
	container.appendChild(toast);
	setTimeout(() => {
		toast.classList.add('exit');
		toast.addEventListener('animationend', () => toast.remove());
	}, duration);
};

// ---------------------------------------------------------------------------
// Modal / Notice
// ---------------------------------------------------------------------------

const openModal = (msg) => {
	$('#modalMsg').textContent = msg || '';
	showModal($('#modal'));
};
const closeModal = () => { hideModal($('#modal')); };

// ---------------------------------------------------------------------------
// Watch History (persisted to localStorage + cookie)
// ---------------------------------------------------------------------------

const WATCH_HISTORY_KEY = 'ycp_watch_history_v1';
const MAX_HISTORY_ITEMS = 50;

/**
 * Load watch history array from storage.
 * Each entry: { id, title, channel, duration, thumb, watchedAt }
 */
const loadWatchHistory = () => {
	try {
		const raw = localStorage.getItem(WATCH_HISTORY_KEY);
		if (raw) {
			const parsed = JSON.parse(raw);
			if (Array.isArray(parsed)) return parsed;
		}
	} catch {}
	try {
		const c = _getCookie(WATCH_HISTORY_KEY);
		if (c) {
			const parsed = JSON.parse(c);
			if (Array.isArray(parsed)) return parsed;
		}
	} catch {}
	return [];
};

/**
 * Save watch history to localStorage + cookie.
 * Cookie holds a compact version (just ids + timestamps) due to size limits.
 */
const saveWatchHistory = (history) => {
	const trimmed = (history || []).slice(0, MAX_HISTORY_ITEMS);
	try { localStorage.setItem(WATCH_HISTORY_KEY, JSON.stringify(trimmed)); } catch {}
	// Cookie has ~4KB limit, store compact version with essential fields only
	try {
		const compact = trimmed.slice(0, 20).map(h => ({
			id: h.id,
			title: (h.title || '').substring(0, 60),
			channel: (h.channel || '').substring(0, 30),
			duration: h.duration || '',
			watchedAt: h.watchedAt,
		}));
		_setCookie(WATCH_HISTORY_KEY, JSON.stringify(compact), 365);
	} catch {}
};

/**
 * Add a video to watch history. Deduplicates by video ID (moves to front).
 */
const addToWatchHistory = (video) => {
	if (!video || !video.id) return;
	const history = loadWatchHistory();
	// Remove existing entry with same ID
	const filtered = history.filter(h => h.id !== video.id);
	// Add to front
	filtered.unshift({
		id: video.id,
		title: video.title || '',
		channel: video.channel || '',
		duration: video.duration || '',
		thumb: video.thumb || `/api/thumb/${video.id}?q=hq`,
		watchedAt: Date.now(),
	});
	saveWatchHistory(filtered);
};

/**
 * Clear all watch history.
 */
const clearWatchHistory = () => {
	try { localStorage.removeItem(WATCH_HISTORY_KEY); } catch {}
	_setCookie(WATCH_HISTORY_KEY, '[]', 365);
};

// ---------------------------------------------------------------------------
// URL detection helpers
// ---------------------------------------------------------------------------

const isYouTubeUrl = (s) => /^https?:\/\/(www\.)?((youtube\.com\/)|(youtu\.be\/))/i.test(s);
const isPlaylistUrl = (s) => /[?&]list=/.test(s);
const isChannelUrl = (s) => /youtube\.com\/(channel\/|@|c\/|user\/)/i.test(s);

const extractVideoId = (s) => {
	let m = s.match(/[?&]v=([A-Za-z0-9_-]{11})/);
	if (m) return m[1];
	m = s.match(/youtu\.be\/([A-Za-z0-9_-]{11})/);
	if (m) return m[1];
	m = s.match(/\/shorts\/([A-Za-z0-9_-]{11})/);
	if (m) return m[1];
	return null;
};

const extractPlaylistId = (s) => {
	const m = s.match(/[?&]list=([A-Za-z0-9_-]+)/);
	return m ? m[1] : null;
};

const extractChannelHandle = (s) => {
	let m = s.match(/youtube\.com\/(@[A-Za-z0-9_.-]+)/i);
	if (m) return m[1];
	m = s.match(/youtube\.com\/channel\/([A-Za-z0-9_-]+)/i);
	if (m) return m[1];
	m = s.match(/youtube\.com\/c\/([A-Za-z0-9_.-]+)/i);
	if (m) return m[1];
	m = s.match(/youtube\.com\/user\/([A-Za-z0-9_.-]+)/i);
	if (m) return m[1];
	return null;
};
