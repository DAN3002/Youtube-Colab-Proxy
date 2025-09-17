const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Global playback state
let currentMode = 'search'; // 'search' | 'playlist' | 'video' | 'streamlink'
let currentTab = 'youtube'; // 'youtube' | 'streamlink'
let paging = { page: 1, totalPages: 1, hasMore: false };
let pageSize = 8;
let searchQuery = '';
let playlistUrl = '';
let currentPlaylistIndex = -1; // global index across playlist
let listType = 'playlist'; // 'playlist' | 'channel'

const updatePlayerControls = () => {
	$('#playerControls').style.display = currentPlaylistIndex >= 0 ? 'flex' : 'none';
};

const setStatus = (text) => { $('#status').textContent = text || ''; };

const openModal = (msg) => {
	$('#modalMsg').textContent = msg || '';
	const m = $('#modal');
	m.style.display = 'flex';
};
const closeModal = () => { $('#modal').style.display = 'none'; };
$('#modalClose')?.addEventListener('click', closeModal);

const clearListUI = () => {
	$('#results').innerHTML = '';
	$('#pager').style.display = 'none';
};

const formatDuration = (d) => {
	if (!d) return '';
	if (typeof d === 'string') {
		// Keep as-is if already formatted like 3:45 or 1:02:03
		return d;
	}
	const sec = Number(d) || 0;
	const h = Math.floor(sec / 3600);
	const m = Math.floor((sec % 3600) / 60);
	const s = Math.floor(sec % 60);
	const pad = (x) => String(x).padStart(2, '0');
	return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${m}:${pad(s)}`;
};

const renderCards = (mountNode, items, {onClick} = {}) => {
	// normalize duration/channel keys
	items = (items || []).map(v => ({
		...v,
		duration: v.duration || v.duration_string || '',
		channel: v.channel || (v.uploader || ''),
	}));
	mountNode.innerHTML = items.map((v) => `
		<div class="card" data-id="${v.id}" data-title="${encodeURIComponent(v.title)}">
			<img class="thumb" loading="lazy" src="${v.thumb}" alt="${v.title}" />
			<div style="margin-top:8px; font-weight:600;">${v.title}</div>
			<div class="muted">${v.channel || ''}</div>
			<div class="muted">${formatDuration(v.duration) || ''}</div>
		</div>
	`).join('');
	mountNode.querySelectorAll('.card').forEach((el, idx) => {
		el.addEventListener('click', () => {
			const id = el.getAttribute('data-id');
			const title = decodeURIComponent(el.getAttribute('data-title') || '');
			onClick && onClick({ id, title, el, idx });
		});
	});
};

const setPlayer = (src, title, channel='') => {
	const v = $('#player');
	const isHls = typeof src === 'string' && src.includes('.m3u8') || src.includes('/streamlink/hls');
	
	if (isHls && window.Hls && Hls.isSupported()) {
		try {
			if (v._hls) { v._hls.destroy(); v._hls = null; }
			const hls = new Hls({ lowLatencyMode: true, enableWorker: true });
			hls.loadSource(src);
			hls.attachMedia(v);
			v._hls = hls;
		} catch {}
	} else {
		if (v._hls) { try { v._hls.destroy(); } catch {} v._hls = null; }
		v.src = src;
	}
	v.currentTime = 0;
	v.play().catch(() => {});
	$('#playerWrap').style.display = 'block';
	$('#nowPlaying').textContent = title || '';
	$('#nowChannel').textContent = channel || '';
	$('#openStream').href = src;
};

const playById = (id, title, channel='') => setPlayer(`/stream?id=${encodeURIComponent(id)}`, title, channel);

// Backend calls
const fetchSearchPage = async (q, page) => {
	setStatus(`Search: "${q}" (page ${page})...`);
	$('#results').innerHTML = '<div class="muted">Loading…</div>';
	const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${page}`);
	return r.json();
};

const fetchPlaylistPage = async (url, page) => {
	const label = listType === 'channel' ? 'Channel' : 'Playlist';
	setStatus(`${label} page ${page}...`);
	$('#results').innerHTML = '<div class="muted">Loading…</div>';
	const r = await fetch(`/api/playlist?url=${encodeURIComponent(url)}&page=${page}`);
	return r.json();
};

const renderSearch = async (page) => {
	try {
		const j = await fetchSearchPage(searchQuery, page);
		if ((j.items || []).length === 0) {
			openModal('No videos found for your search.');
			$('#results').innerHTML = '';
			updatePager();
			return;
		}
		pageSize = j.pageSize || pageSize;
		paging = { page: j.page || 1, totalPages: j.totalPages || (j.hasMore ? (j.page + 1) : 1), hasMore: !!j.hasMore };
		renderCards($('#results'), (j.items || []), {
			onClick: ({ id, title, el }) => {
				currentMode = 'video';
				currentPlaylistIndex = -1;
				updatePlayerControls();
				setStatus('Playing video');
				const channel = el.querySelector('.muted')?.textContent || '';
				playById(id, title, channel);
			}
		});
		setStatus(`Search results (page ${paging.page}${paging.totalPages ? `/${paging.totalPages}` : ''})`);
		updatePager();
	} catch (e) {
		openModal(`Search failed: ${e}`);
	}
};

const renderPlaylist = async (page) => {
	try {
		const j = await fetchPlaylistPage(playlistUrl, page);
		if ((j.items || []).length === 0) {
			openModal(listType === 'channel' ? 'No videos found for this channel.' : 'No videos found in this playlist.');
			$('#results').innerHTML = '';
			updatePager();
			return;
		}
		pageSize = j.pageSize || pageSize;
		paging = { page: j.page || 1, totalPages: j.totalPages || 1, hasMore: (j.page || 1) < (j.totalPages || 1) };
		renderCards($('#results'), (j.items || []), {
			onClick: ({ idx }) => {
				const globalIdx = (paging.page - 1) * pageSize + idx;
				playPlaylistIndex(globalIdx);
			}
		});
		// highlight playing item if visible
		Array.from($('#results').querySelectorAll('.card')).forEach((el, i) => {
			const gi = (paging.page - 1) * pageSize + i;
			if (gi === currentPlaylistIndex) el.classList.add('active'); else el.classList.remove('active');
		});
		const label = listType === 'channel' ? 'Channel' : 'Playlist';
		setStatus(`${label} (page ${paging.page}/${paging.totalPages})`);
		updatePager();
	} catch (e) {
		openModal(`${listType === 'channel' ? 'Channel' : 'Playlist'} failed: ${e}`);
	}
};

const updatePager = () => {
	const p = $('#pager');
	if (currentMode === 'search') {
		p.style.display = (paging.page > 1 || paging.hasMore) ? 'flex' : 'none';
		$('#pageInfo').textContent = `Page ${paging.page}` + (paging.totalPages ? ` / ${paging.totalPages}` : '');
	} else if (currentMode === 'playlist') {
		p.style.display = paging.totalPages > 1 ? 'flex' : 'none';
		$('#pageInfo').textContent = `Page ${paging.page} / ${paging.totalPages}`;
	} else {
		p.style.display = 'none';
	}
};

// Playlist playback helpers
const playPlaylistIndex = async (globalIdx) => {
	if (!playlistUrl) return;
	const total = (paging.totalPages || 1) * pageSize; // approximate, good enough to page next/prev
	if (globalIdx < 0) return;
	currentPlaylistIndex = globalIdx;
	updatePlayerControls();
	const page = Math.floor(globalIdx / pageSize) + 1;
	if (page !== paging.page || currentMode !== 'playlist') {
		currentMode = 'playlist';
		await renderPlaylist(page);
	}
	const localIdx = globalIdx % pageSize;
	const item = $('#results').querySelectorAll('.card')[localIdx];
	if (item) {
		const id = item.getAttribute('data-id');
		const title = decodeURIComponent(item.getAttribute('data-title') || '');
		const channel = item.querySelector('.muted')?.textContent || '';
		setStatus('Playing from playlist');
		playById(id, title, channel);
	}
	Array.from($('#results').querySelectorAll('.card')).forEach((el, i) => {
		const gi = (paging.page - 1) * pageSize + i;
		if (gi === currentPlaylistIndex) el.classList.add('active'); else el.classList.remove('active');
	});
};

const nextInPlaylist = async () => {
	if (currentPlaylistIndex < 0) return;
	await playPlaylistIndex(currentPlaylistIndex + 1);
};
const prevInPlaylist = async () => {
	if (currentPlaylistIndex <= 0) return;
	await playPlaylistIndex(currentPlaylistIndex - 1);
};
$('#btnPrev').addEventListener('click', prevInPlaylist);
$('#btnNext').addEventListener('click', nextInPlaylist);
$('#player').addEventListener('ended', () => { if (currentPlaylistIndex >= 0) nextInPlaylist(); });

// Input handling
const isYouTubeUrl = (s) => /^https?:\/\/(www\.)?((youtube\.com\/)|(youtu\.be\/))/i.test(s);
const isPlaylistUrl = (s) => /[?&]list=/.test(s);
const isChannelUrl = (s) => /youtube\.com\/(channel\/|@|c\/|user\/)/i.test(s);

const go = async () => {
	const s = $('#q').value.trim();
	if (!s) return;
	if (isYouTubeUrl(s)) {
		if (isPlaylistUrl(s) || isChannelUrl(s)) {
			currentMode = 'playlist';
			playlistUrl = s;
			listType = isChannelUrl(s) ? 'channel' : 'playlist';
			currentPlaylistIndex = -1;
			updatePlayerControls();
			setStatus(listType === 'channel' ? 'Loading channel...' : 'Loading playlist...');
			await renderPlaylist(1);
		} else {
			currentMode = 'video';
			currentPlaylistIndex = -1;
			playlistUrl = '';
			updatePlayerControls();
			clearListUI();
			setStatus('Playing video');
			setPlayer(`/stream?url=${encodeURIComponent(s)}`, 'Custom video', '');
		}
	} else {
		currentMode = 'search';
		searchQuery = s;
		currentPlaylistIndex = -1;
		updatePlayerControls();
		setStatus('Searching...');
		await renderSearch(1);
	}
};
$('#btnGo').addEventListener('click', go);
$('#q').addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });

$('#btnPrevPage').addEventListener('click', async () => {
	if (currentMode === 'search' && paging.page > 1) { setStatus('Searching...'); await renderSearch(paging.page - 1); }
	else if (currentMode === 'playlist' && paging.page > 1) { setStatus(listType === 'channel' ? 'Loading channel...' : 'Loading playlist...'); await renderPlaylist(paging.page - 1); }
});
$('#btnNextPage').addEventListener('click', async () => {
	if (currentMode === 'search' && (paging.hasMore || (paging.totalPages && paging.page < paging.totalPages))) { setStatus('Searching...'); await renderSearch(paging.page + 1); }
	else if (currentMode === 'playlist' && paging.page < paging.totalPages) { setStatus(listType === 'channel' ? 'Loading channel...' : 'Loading playlist...'); await renderPlaylist(paging.page + 1); }
});

// Tab switching functionality
const switchTab = (tabName) => {
	currentTab = tabName;
	
	// Update tab buttons
	$$('.tab-btn').forEach(btn => btn.classList.remove('active'));
	$(`#tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`).classList.add('active');
	
	// Update tab content
	$$('.tab-content').forEach(content => content.classList.remove('active'));
	$(`#${tabName}Tab`).classList.add('active');
	
	// Clear status and results when switching tabs
	clearListUI();
	setStatus('');
	setStreamStatus('');
	hidePlayer();
};

$('#tabYoutube').addEventListener('click', () => switchTab('youtube'));
$('#tabStreamlink').addEventListener('click', () => switchTab('streamlink'));

// Streamlink functionality
const setStreamStatus = (text) => { $('#streamStatus').textContent = text || ''; };

// Stream settings persistence
const SETTINGS_KEY = 'ycp_stream_settings_v1';
const loadSettings = () => {
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (!raw) return { delay: 30 };
		const j = JSON.parse(raw);
		const d = Number.isFinite(j.delay) ? j.delay : 30;
		return { delay: Math.max(0, Math.min(600, d)) };
	} catch { return { delay: 30 }; }
};
const saveSettings = (s) => {
	try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s || { delay: 30 })); } catch {}
};

// Settings modal controls
const openSettings = () => {
	const s = loadSettings();
	const el = $('#settingsDelay');
	if (el) el.value = String(s.delay);
	const m = $('#settingsModal');
	if (m) m.style.display = 'flex';
};
const closeSettings = () => { const m = $('#settingsModal'); if (m) m.style.display = 'none'; };
$('#btnStreamSettings')?.addEventListener('click', openSettings);
$('#settingsCancel')?.addEventListener('click', closeSettings);
$('#settingsSave')?.addEventListener('click', () => {
	const el = $('#settingsDelay');
	let v = 30;
	if (el) {
		const raw = parseInt(el.value, 10);
		v = Number.isNaN(raw) ? 30 : raw;
	}
	saveSettings({ delay: Math.max(0, Math.min(600, v)) });
	closeSettings();
});

// Delay & overlay helpers for Stream tab
const getDelaySeconds = () => {
	const s = loadSettings();
	return Math.max(0, Math.min(600, Number(s.delay || 30)));
};

const showStreamLoading = (msg) => {
	const o = $('#streamLoading');
	if (!o) return;
	o.style.display = 'flex';
	const m = $('#streamLoadingMsg');
	if (m) m.textContent = msg || 'Buffering…';
};

const hideStreamLoading = () => {
	const o = $('#streamLoading');
	if (o) o.style.display = 'none';
};

const _secondsBufferedAhead = (video) => {
	const t = video.currentTime;
	const ranges = video.buffered;
	for (let i = 0; i < ranges.length; i++) {
		const start = ranges.start(i);
		const end = ranges.end(i);
		if (t >= start && t <= end) return Math.max(0, end - t);
	}
	return 0;
};

const setDelayedHlsPlayer = (src, title, channel = '', delaySec = 30) => {
	const v = $('#player');
	// Lock native controls for watch-only experience
	try {
		v.controls = false;
		v.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback');
		v.setAttribute('disablePictureInPicture', 'true');
	} catch {}
	
	const minStartBuffer = Math.max(10, Math.min(90, delaySec));
	showStreamLoading(`Buffering ~${minStartBuffer}s at ${delaySec}s behind live…`);
	
	// Overlay failsafe timer
	let overlayTimer = null;
	const clearOverlayTimer = () => { if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; } };
	overlayTimer = setTimeout(() => hideStreamLoading(), 30000);
	
	// Destroy previous instance if any
	if (v._hls) { try { v._hls.destroy(); } catch {} v._hls = null; }
	
	// Remove previous overlay event handlers if any
	if (v._overlayHandlers) {
		try {
			v.removeEventListener('playing', v._overlayHandlers.playing);
			v.removeEventListener('canplay', v._overlayHandlers.canplay);
		} catch {}
	}
	
	const onPlaying = () => { hideStreamLoading(); clearOverlayTimer(); };
	const onCanPlay = () => { hideStreamLoading(); };
	v.addEventListener('playing', onPlaying);
	v.addEventListener('canplay', onCanPlay);
	v._overlayHandlers = { playing: onPlaying, canplay: onCanPlay };
	
	// Remove previous lock handlers if any
	if (v._lockHandlers) {
		try {
			v.removeEventListener('pause', v._lockHandlers.pause);
			v.removeEventListener('seeking', v._lockHandlers.seeking);
			v.removeEventListener('timeupdate', v._lockHandlers.timeupdate);
			document.removeEventListener('keydown', v._lockHandlers.keydown, true);
		} catch {}
	}
	let lastOkTime = 0;
	const onTimeUpdate = () => { lastOkTime = v.currentTime || lastOkTime; };
	const onPause = () => { v.play().catch(() => {}); };
	const onSeeking = (e) => {
		// Disallow all seeking; snap back to last ok time
		if (Number.isFinite(lastOkTime)) {
			try { v.currentTime = lastOkTime; } catch {}
		}
		if (e && typeof e.preventDefault === 'function') e.preventDefault();
	};
	const onKeyDown = (e) => {
		// Block common media keys during streamlink playback
		if (currentMode === 'streamlink') {
			const blocked = [' ', 'k', 'K', 'j', 'J', 'l', 'L', 'ArrowLeft', 'ArrowRight', 'Home', 'End'];
			if (blocked.includes(e.key)) {
				e.stopPropagation();
				e.preventDefault();
			}
		}
	};
	v.addEventListener('timeupdate', onTimeUpdate);
	v.addEventListener('pause', onPause);
	v.addEventListener('seeking', onSeeking);
	document.addEventListener('keydown', onKeyDown, true);
	v._lockHandlers = { timeupdate: onTimeUpdate, pause: onPause, seeking: onSeeking, keydown: onKeyDown };
	
	const hls = new Hls({
		lowLatencyMode: false,
		enableWorker: true,
		// Keep a stable delayed position
		liveSyncDuration: delaySec,
		liveMaxLatencyDuration: delaySec + 10,
		// Buffer more ahead for smoother playback
		maxBufferLength: Math.max(120, delaySec + 90),
		maxBufferHole: 0.2,
		maxBufferSize: 80 * 1000 * 1000,
		liveBackBufferLength: 900,
		startPosition: -1,
	});
	let started = false;
	let seekedToDelay = false;
	let guardHandlersBound = false;
	
	const clampForward = (e) => {
		try {
			let allowedMax = null;
			if (typeof hls.liveSyncPosition === 'number') {
				allowedMax = hls.liveSyncPosition;
			} else {
				const br = v.buffered; 
				if (br && br.length) allowedMax = br.end(br.length - 1) - 2;
			}
			if (allowedMax != null && v.currentTime > allowedMax) {
				v.currentTime = allowedMax;
				if (e && typeof e.preventDefault === 'function') e.preventDefault();
			}
		} catch {}
	};
	
	hls.on(Hls.Events.ERROR, function(event, data) {
		if (data && data.fatal) {
			hideStreamLoading();
			clearOverlayTimer();
			setStreamStatus('Streaming error. Please try again.');
		}
	});
	
	hls.on(Hls.Events.LEVEL_LOADED, function (event, data) {
		try {
			if (data && data.details && data.details.live) {
				const livePos = (typeof hls.liveSyncPosition === 'number') ? hls.liveSyncPosition : (data.details.edge - delaySec);
				if (!seekedToDelay && typeof livePos === 'number' && isFinite(livePos)) {
					v.currentTime = Math.max(0, livePos);
					seekedToDelay = true;
					lastOkTime = v.currentTime;
				}
			}
		} catch {}
	});
	
	const checkStart = () => {
		if (started) return;
		const ahead = _secondsBufferedAhead(v);
		if (ahead >= minStartBuffer) {
			started = true;
			hideStreamLoading();
			clearOverlayTimer();
			v.play().catch(() => {});
		}
	};
	
	hls.on(Hls.Events.BUFFER_APPENDED, checkStart);
	hls.on(Hls.Events.FRAG_BUFFERED, checkStart);
	
	hls.loadSource(src);
	hls.attachMedia(v);
	v._hls = hls;
	v.pause();
	
	// Bind guard once
	if (!guardHandlersBound) {
		v.addEventListener('seeking', clampForward);
		v.addEventListener('timeupdate', clampForward);
		guardHandlersBound = true;
	}
	
	// Update UI
	$('#playerWrap').style.display = 'block';
	$('#nowPlaying').textContent = title || '';
	$('#nowChannel').textContent = channel || '';
	$('#openStream').href = src;
};

const hidePlayer = () => {
	$('#playerWrap').style.display = 'none';
	$('#playerControls').style.display = 'none';
};

const getPlatformTitle = (url) => {
	try {
		const u = new URL(url);
		const h = u.hostname.toLowerCase();
		if (h.includes('twitch')) return 'Twitch Stream';
		if (h.includes('vimeo')) return 'Vimeo Stream';
		if (h.includes('facebook')) return 'Facebook Stream';
		if (h.includes('tiktok')) return 'TikTok Stream';
		if (h.includes('kick')) return 'Kick Stream';
		if (h.includes('afreecatv')) return 'AfreecaTV Stream';
		if (h.includes('bilibili')) return 'Bilibili Stream';
		if (h.includes('dailymotion')) return 'Dailymotion Stream';
		if (h.includes('twitter') || h.includes('x.com')) return 'X Stream';
		if (h.includes('instagram')) return 'Instagram Stream';
		if (h.includes('youtube') || h.includes('youtu.be')) return 'YouTube Live';
	} catch (e) {}
	return 'Live Stream';
};

// Quality selection removed: always use 'best'
// loadStreamInfo removed - now using direct play with error handling

const playStreamlinkVideo = () => {
	const url = $('#streamUrl').value.trim();
	
	if (!url) {
		setStreamStatus('Please enter a streaming URL');
		return;
	}
	
	setStreamStatus('Loading stream...');
	
	currentMode = 'streamlink';
	currentPlaylistIndex = -1;
	updatePlayerControls();
	clearListUI();
	
	const delaySec = getDelaySeconds();
	
	// Check if stream is supported first, then play
	fetch(`/api/streamlink/info?url=${encodeURIComponent(url)}`)
		.then(response => response.json())
		.then(data => {
			if (!data.supported) {
				setStreamStatus(data.error || 'Stream not supported or unavailable');
				return;
			}
			
			const title = getPlatformTitle(url);
			const manifest = `/streamlink/hls?url=${encodeURIComponent(url)}`;
			if (delaySec > 0) {
				setDelayedHlsPlayer(manifest, title, '', delaySec);
				setStreamStatus(`Playing stream (delayed ${delaySec}s)...`);
			} else {
				setPlayer(manifest, title, '');
				setStreamStatus('Playing stream...');
			}
		})
		.catch(error => {
			setStreamStatus(`Error: ${error.message}`);
		});
};

$('#btnPlayStream').addEventListener('click', playStreamlinkVideo);
$('#streamUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') playStreamlinkVideo(); }); 
