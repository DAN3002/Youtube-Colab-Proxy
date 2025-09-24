const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

// Cross-subdomain settings helpers (for *.prod.colab.dev)
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
		d.setTime(d.getTime() + (days*24*60*60*1000));
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

// Global playback state
let currentMode = 'search'; // 'search' | 'playlist' | 'video'
let currentTab = 'youtube'; // only 'youtube' (streamlink disabled)
let paging = { page: 1, totalPages: 1, hasMore: false };
let pageSize = 8;
let searchQuery = '';
let playlistUrl = '';
let currentPlaylistIndex = -1; // global index across playlist
let listType = 'playlist'; // 'playlist' | 'channel'
let currentListSource = null; // 'search' | 'playlist' | null

const updatePlayerControls = () => {
	const pc = $('#playerControls');
	if (!pc) return;
	pc.style.display = 'none';
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

const showSkeletons = (count = 8) => {
	const nodes = Array.from({ length: count }).map(() => `
		<div class="card">
			<div class="thumb skeleton" style="aspect-ratio:16/9;"></div>
			<div style="margin-top:8px;">
				<div class="skeleton" style="height:14px; width:90%; border-radius:6px;"></div>
				<div class="skeleton" style="height:12px; width:60%; margin-top:6px; border-radius:6px;"></div>
			</div>
		</div>
	`).join('');
	$('#results').innerHTML = nodes;
};

const formatDuration = (d) => {
    if (d == null || d === '') return '';
    // If string and contains only digits, treat as seconds; if already mm:ss or hh:mm:ss, keep
    if (typeof d === 'string') {
        const s = d.trim();
        if (/^\d+$/.test(s)) {
            d = parseInt(s, 10);
        } else if (/^\d{1,2}:\d{2}(:\d{2})?$/.test(s)) {
            return s;
        } else {
            // fallback: try parse number
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

const renderCards = (mountNode, items, {onClick} = {}) => {
	// normalize duration/channel keys
	items = (items || []).map(v => ({
		...v,
		duration: v.duration || v.duration_string || '',
		channel: v.channel || (v.uploader || ''),
	}));
	mountNode.innerHTML = items.map((v) => `
		<div class="card" data-id="${v.id}" data-title="${encodeURIComponent(v.title)}">
			<div class="thumb-wrap">
				<img class="thumb" loading="lazy" src="${v.thumb}" alt="${v.title}" />
				${v.duration ? `<span class="duration-badge">${formatDuration(v.duration)}</span>` : ''}
			</div>
			<div style="margin-top:8px; font-weight:600;" class="clamp-2">${v.title}</div>
			<div class="muted clamp-1">${v.channel || ''}</div>
		</div>
	`).join('');
	mountNode.querySelectorAll('.card').forEach((el, idx) => {
		el.addEventListener('click', () => {
			// highlight active card within current mount
			Array.from(mountNode.querySelectorAll('.card')).forEach(n => n.classList.remove('active'));
			el.classList.add('active');
			const id = el.getAttribute('data-id');
			const title = decodeURIComponent(el.getAttribute('data-title') || '');
			onClick && onClick({ id, title, el, idx });
		});
	});
};

const setPlayer = (src, title, channel='') => {
	const v = $('#player');
	const isHls = typeof src === 'string' && src.includes('.m3u8') || src.includes('/streamlink/hls');

	// Reset per-video resolution dropdown visibility
	const resSel = $('#videoResolution');
	if (resSel) {
		resSel.style.display = 'none';
		resSel.innerHTML = '';
	}
	
	// Remove existing error handlers
	if (v._errorHandler) {
		v.removeEventListener('error', v._errorHandler);
		v._errorHandler = null;
	}
	
	// Add error handler for video loading failures
	const errorHandler = (e) => {
		console.error('Video load error:', e);
		let errorMsg = 'Failed to load video. ';
		
		// Try to get more specific error info
		if (v.error) {
			switch (v.error.code) {
				case v.error.MEDIA_ERR_ABORTED:
					errorMsg += 'Video loading was aborted.';
					break;
				case v.error.MEDIA_ERR_NETWORK:
					errorMsg += 'Network error occurred while loading video.';
					break;
				case v.error.MEDIA_ERR_DECODE:
					errorMsg += 'Video format is not supported or corrupted.';
					break;
				case v.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
					errorMsg += 'Video source is not supported or unavailable.';
					break;
				default:
					errorMsg += 'Unknown error occurred.';
			}
		} else {
			errorMsg += 'Please try again or check the video URL.';
		}
		
		openModal(errorMsg);
		$('#playerWrap').style.display = 'none';
		setStatus('Video load failed');
	};
	
	v.addEventListener('error', errorHandler);
	v._errorHandler = errorHandler;
	
	if (isHls && window.Hls && Hls.isSupported()) {
		try {
			if (v._hls) { v._hls.destroy(); v._hls = null; }
			const hls = new Hls({ lowLatencyMode: true, enableWorker: true });
			
			// Add HLS error handling
			hls.on(window.Hls.Events.ERROR, (event, data) => {
				if (data.fatal) {
					console.error('HLS fatal error:', data);
					let errorMsg = 'Failed to stream video. ';
					
					switch (data.type) {
						case window.Hls.ErrorTypes.NETWORK_ERROR:
							errorMsg += 'Network connection issue.';
							break;
						case window.Hls.ErrorTypes.MEDIA_ERROR:
							errorMsg += 'Video format or codec issue.';
							break;
						default:
							errorMsg += 'Streaming service unavailable.';
					}
					
					openModal(errorMsg);
					$('#playerWrap').style.display = 'none';
					setStatus('Stream failed');
				}
			});
			
			hls.loadSource(src);
			hls.attachMedia(v);
			v._hls = hls;
		} catch (err) {
			console.error('HLS setup error:', err);
			openModal('Failed to initialize video player. Please try again.');
			return;
		}
	} else {
		if (v._hls) { try { v._hls.destroy(); } catch {} v._hls = null; }
		v.src = src;
	}
	
	v.currentTime = 0;
	v.play().catch((err) => {
		console.error('Video play error:', err);
		// Don't show modal for autoplay issues, just log
	});
	
	$('#playerWrap').style.display = 'block';
	$('#nowPlaying').textContent = title || '';
	$('#nowChannel').textContent = channel || '';
	$('#openStream').href = src;
	try { document.getElementById('playerWrap').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
};

const playById = (id, title, channel='') => {
	const app = loadAppSettings();
	const h = Number(app.resolution || 0);
	const qs = h > 0 ? `&h=${h}` : '';
	const url = `/stream?id=${encodeURIComponent(id)}${qs}`;
	setPlayer(url, title, channel);
	// Fetch formats and populate resolution select
	fetch(`/api/formats?id=${encodeURIComponent(id)}`)
		.then(r => r.json())
		.then(data => {
			const sel = $('#videoResolution');
			if (!sel) return;
			const formats = (data && Array.isArray(data.formats)) ? data.formats : [];
			if (formats.length === 0) { sel.style.display = 'none'; return; }
			// Build options: Auto + heights
			const app = loadAppSettings();
			const cur = Number(app.resolution || 0);
			let html = `<option value="0">Auto</option>`;
			html += formats.map(f => `<option value="${f.height}">${f.label}</option>`).join('');
			sel.innerHTML = html;
			sel.value = String(cur > 0 ? cur : 0);
			sel.style.display = '';
			// Change handler reloads current video with chosen height
			sel.onchange = () => {
				const newH = parseInt(sel.value, 10) || 0;
				saveAppSettings({ ...loadAppSettings(), resolution: newH });
				const qs2 = newH > 0 ? `&h=${newH}` : '';
				setPlayer(`/stream?id=${encodeURIComponent(id)}${qs2}`, title, channel);
			};
		})
		.catch(() => {});
};

// App settings
const APP_SETTINGS_KEY = 'ycp_app_settings_v3';
// onEnd: 'stop' | 'loop' | 'next'; resolution: 0(best) or max height
const defaultAppSettings = { onEnd: 'stop', resolution: 0 };
const loadAppSettings = () => {
	// Prefer localStorage; fallback to shared cookie for *.prod.colab.dev
	try {
		const raw = localStorage.getItem(APP_SETTINGS_KEY);
		if (raw) {
			const j = JSON.parse(raw);
			return { ...defaultAppSettings, ...j };
		}
	} catch {}
	try {
		const c = _getCookie(APP_SETTINGS_KEY);
		if (c) {
			const j = JSON.parse(c);
			return { ...defaultAppSettings, ...j };
		}
	} catch {}
	return { ...defaultAppSettings };
};
const saveAppSettings = (s) => {
	const payload = JSON.stringify({ ...defaultAppSettings, ...(s||{}) });
	try { localStorage.setItem(APP_SETTINGS_KEY, payload); } catch {}
	_setCookie(APP_SETTINGS_KEY, payload, 365);
};

// Backend calls
const fetchSearchPage = async (q, page) => {
	setStatus(`Search: "${q}" (page ${page})...`);
	showSkeletons(pageSize);
	try {
		const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${page}`);
		if (!r.ok) {
			throw new Error(`Search failed: ${r.status} ${r.statusText}`);
		}
		return await r.json();
	} catch (err) {
		openModal(`Search error: ${err.message || 'Network or server issue occurred.'}`);
		throw err;
	}
};

const fetchPlaylistPage = async (url, page) => {
	const label = listType === 'channel' ? 'Channel' : 'Playlist';
	setStatus(`${label} page ${page}...`);
	$('#results').innerHTML = '<div class="muted">Loading…</div>';
	try {
		const r = await fetch(`/api/playlist?url=${encodeURIComponent(url)}&page=${page}`);
		if (!r.ok) {
			throw new Error(`${label} failed: ${r.status} ${r.statusText}`);
		}
		return await r.json();
	} catch (err) {
		openModal(`${label} error: ${err.message || 'Network or server issue occurred.'}`);
		throw err;
	}
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
            onClick: ({ id, title, el, idx }) => {
                // treat search as a list with global index
                const globalIdx = (paging.page - 1) * pageSize + idx;
                currentListSource = 'search';
                currentPlaylistIndex = globalIdx;
                currentMode = 'search';
                updatePlayerControls();
                setStatus('Playing from search');
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
                currentListSource = 'playlist';
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
    if (globalIdx < 0) return;
    currentPlaylistIndex = globalIdx;
    updatePlayerControls();
    const page = Math.floor(globalIdx / pageSize) + 1;
    if (currentListSource === 'playlist') {
        if (!playlistUrl) return;
        if (page !== paging.page || currentMode !== 'playlist') {
            currentMode = 'playlist';
            await renderPlaylist(page);
        }
    } else if (currentListSource === 'search') {
        if (!searchQuery) return;
        if (page !== paging.page || currentMode !== 'search') {
            currentMode = 'search';
            await renderSearch(page);
        }
    } else {
        return; // not in a list
    }
    const localIdx = globalIdx % pageSize;
    const item = $('#results').querySelectorAll('.card')[localIdx];
    if (item) {
        const id = item.getAttribute('data-id');
        const title = decodeURIComponent(item.getAttribute('data-title') || '');
        const channel = item.querySelector('.muted')?.textContent || '';
        setStatus(currentListSource === 'playlist' ? 'Playing from playlist' : 'Playing from search');
        playById(id, title, channel);
    }
    Array.from($('#results').querySelectorAll('.card')).forEach((el, i) => {
        const gi = (paging.page - 1) * pageSize + i;
        if (gi === currentPlaylistIndex) el.classList.add('active'); else el.classList.remove('active');
    });
};

const nextInPlaylist = async () => {
    if (currentPlaylistIndex < 0) return;
    const nextIdx = currentPlaylistIndex + 1;
    // If advancing beyond current page and we don't have more pages in search, stop
    if (currentListSource === 'search') {
        const isLastOnPage = (currentPlaylistIndex % pageSize) === (pageSize - 1);
        if (isLastOnPage) {
            // only advance if has more pages
            if (!(paging.hasMore || (paging.totalPages && paging.page < paging.totalPages))) {
                return; // no more
            }
        }
    }
    await playPlaylistIndex(nextIdx);
};
const prevInPlaylist = async () => {
    if (currentPlaylistIndex <= 0) return;
    await playPlaylistIndex(currentPlaylistIndex - 1);
};
// Next/Prev controls removed
$('#player').addEventListener('ended', () => {
	const s = loadAppSettings();
	const onEnd = (s.onEnd || 'stop');

	// If playing a direct pasted link (custom video), always stop
	// We detect this by currentMode === 'video' and playlistUrl is empty and searchQuery may be a URL
	if (currentMode === 'video' && !playlistUrl && isYouTubeUrl($('#q').value.trim())) {
		return; // stop
	}

	if (currentPlaylistIndex >= 0 && (currentListSource === 'search' || currentListSource === 'playlist')) {
		if (onEnd === 'loop') {
			try { const v = $('#player'); v.currentTime = 0; v.play().catch(() => {}); } catch {}
			return;
		}
		if (onEnd === 'next') { nextInPlaylist(); return; }
		return; // stop
	}

	if (onEnd === 'loop') {
		try { const v = $('#player'); v.currentTime = 0; v.play().catch(() => {}); } catch {}
		return;
	}

	if (onEnd === 'next' && currentListSource === 'search') { nextInPlaylist(); return; }

	// default: stop
});

// YouTube-like keyboard shortcuts
document.addEventListener('keydown', (e) => {
	const v = $('#player');
	if (!v || $('#playerWrap').style.display === 'none') return;
	if (['INPUT', 'TEXTAREA'].includes(document.activeElement?.tagName)) return;
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
	}
});

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
            currentListSource = 'playlist';
			updatePlayerControls();
			setStatus(listType === 'channel' ? 'Loading channel...' : 'Loading playlist...');
			showSkeletons(pageSize);
			await renderPlaylist(1);
		} else {
			currentMode = 'video';
			currentPlaylistIndex = -1;
			playlistUrl = '';
            currentListSource = null;
			updatePlayerControls();
			clearListUI();
			setStatus('Playing video');
			const app = loadAppSettings();
			const h = Number(app.resolution || 0);
			const qs = h > 0 ? `&h=${h}` : '';
			setPlayer(`/stream?url=${encodeURIComponent(s)}${qs}`, 'Custom video', '');
		}
	} else {
		currentMode = 'search';
		searchQuery = s;
		currentPlaylistIndex = -1;
        currentListSource = null;
		updatePlayerControls();
		setStatus('Searching...');
		showSkeletons(pageSize);
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

$('#tabYoutube')?.addEventListener('click', () => switchTab('youtube'));

// Streamlink functionality (disabled in UI)
const setStreamStatus = (text) => { const el = $('#streamStatus'); if (el) el.textContent = text || ''; };

// Stream settings persistence
const SETTINGS_KEY = 'ycp_stream_settings_v1';
const loadSettings = () => {
	// Prefer localStorage; fallback to shared cookie
	try {
		const raw = localStorage.getItem(SETTINGS_KEY);
		if (raw) {
			const j = JSON.parse(raw);
			const d = Number.isFinite(j.delay) ? j.delay : 30;
			return { delay: Math.max(0, Math.min(600, d)) };
		}
	} catch {}
	try {
		const c = _getCookie(SETTINGS_KEY);
		if (c) {
			const j = JSON.parse(c);
			const d = Number.isFinite(j.delay) ? j.delay : 30;
			return { delay: Math.max(0, Math.min(600, d)) };
		}
	} catch {}
	return { delay: 30 };
};
const saveSettings = (s) => {
	const payload = JSON.stringify(s || { delay: 30 });
	try { localStorage.setItem(SETTINGS_KEY, payload); } catch {}
	_setCookie(SETTINGS_KEY, payload, 365);
};

// Settings modal controls
const openSettings = () => {
	const app = loadAppSettings();
	const sel = $('#optOnEnd');
	if (sel) sel.value = app.onEnd || 'stop';
	const resSel = $('#optResolution');
	if (resSel) resSel.value = String(app.resolution ?? 0);
	const m = $('#settingsModal');
	if (m) m.style.display = 'flex';
};
const closeSettings = () => { const m = $('#settingsModal'); if (m) m.style.display = 'none'; };
$('#btnSettings')?.addEventListener('click', openSettings);
$('#settingsCancel')?.addEventListener('click', closeSettings);
$('#settingsSave')?.addEventListener('click', () => {
	const app = loadAppSettings();
	const sel = $('#optOnEnd');
	const onEnd = (sel && sel.value) ? sel.value : 'stop';
	const resSel = $('#optResolution');
	let resolution = 0;
	if (resSel) {
		const raw = parseInt(resSel.value, 10);
		resolution = Number.isNaN(raw) ? 0 : raw;
	}
	saveAppSettings({ ...app, onEnd, resolution });
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
		.then(async response => {
			if (!response.ok) {
				throw new Error(`Server error: ${response.status} ${response.statusText}`);
			}
			return await response.json();
		})
		.then(data => {
			if (!data.supported) {
				const errorMsg = data.error || 'Stream not supported or unavailable';
				setStreamStatus(errorMsg);
				openModal(`Streaming error: ${errorMsg}`);
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
			const errorMsg = `Streaming error: ${error.message || 'Network or server issue occurred.'}`;
			setStreamStatus(errorMsg);
			openModal(errorMsg);
		});
};

$('#btnPlayStream')?.addEventListener('click', playStreamlinkVideo);
$('#streamUrl')?.addEventListener('keydown', (e) => { if (e.key === 'Enter') playStreamlinkVideo(); });

// Load app version on page load
window.addEventListener('DOMContentLoaded', async () => {
	try {
		const r = await fetch('/api/version');
		if (!r.ok) {
			throw new Error(`Version API failed: ${r.status}`);
		}
		const data = await r.json();
		if (data && data.version) {
			const versionEl = $('#appVersion');
			if (versionEl) versionEl.textContent = `v${data.version}`;
		}
	} catch (err) {
		console.warn('Failed to load version:', err.message);
		// Silent fail - keep default "v..." text, don't show popup for this
	}
}); 
