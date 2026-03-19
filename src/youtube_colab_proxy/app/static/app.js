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

// Global playback state
let currentMode = 'search';
let currentTab = 'youtube';
let paging = { page: 1, totalPages: 1, hasMore: false };
let pageSize = 8;
let searchQuery = '';
let playlistUrl = '';
let currentPlaylistIndex = -1;
let listType = 'playlist';
let currentListSource = null;
let currentPlayingVideoId = null;
let currentPlayingVideoUrl = null;
let commentsReqToken = 0;

// --- UI Helpers ---

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

const updatePlayerControls = () => {
	const pc = $('#playerControls');
	if (!pc) return;
	hideEl(pc);
};

const setStatus = (text) => {
	const el = $('#status');
	if (el) el.textContent = text || '';
};

const syncCommentsPanelHeight = () => {
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

const setCommentsState = (text) => {
	const el = $('#commentsState');
	if (el) el.textContent = text || '';
};

const setCommentsCount = (n) => {
	const el = $('#commentsCount');
	if (!el) return;
	if (!Number.isFinite(n) || n < 0) {
		el.textContent = '';
		return;
	}
	el.textContent = `${n.toLocaleString()} comment${n === 1 ? '' : 's'}`;
};

const clearCommentsList = () => {
	const list = $('#commentsList');
	if (list) list.innerHTML = '';
	setCommentsCount(-1);
};

const renderComments = (comments = []) => {
	const list = $('#commentsList');
	if (!list) return;
	if (!Array.isArray(comments) || comments.length === 0) {
		list.innerHTML = '';
		setCommentsCount(0);
		setCommentsState('No comments found for this video.');
		return;
	}
	setCommentsCount(comments.length);
	setCommentsState('');

	const renderOneComment = (c, isReply = false) => {
		const author = escapeHtml(c.author || 'Unknown');
		const text = escapeHtml(c.text || '').replace(/\n/g, '<br>');
		const avatar = c.author_thumbnail ? escapeHtml(c.author_thumbnail) : '';
		const likes = Number(c.like_count || 0);
		const replies = Number(c.reply_count || 0);
		const time = formatRelativeTime(c.timestamp);
		const childReplies = Array.isArray(c.replies) ? c.replies : [];
		return `
			<div class="comment-item ${isReply ? 'comment-item-reply' : ''}">
				${avatar ? `<img class="comment-avatar" src="${avatar}" alt="${author}" loading="lazy" />` : '<div class="comment-avatar"></div>'}
				<div class="comment-body">
					<div class="comment-meta">
						<span class="comment-author">${author}</span>
						${time ? `<span class="comment-time">${time}</span>` : ''}
					</div>
					<p class="comment-text">${text}</p>
					<div class="comment-actions">
						<span><i class="fa-regular fa-thumbs-up"></i> ${likes.toLocaleString()}</span>
						${!isReply && replies > 0 ? `<span><i class="fa-regular fa-comment"></i> ${replies.toLocaleString()} replies</span>` : ''}
					</div>
					${!isReply && childReplies.length > 0 ? `<div class="comment-replies">${childReplies.map((r) => renderOneComment(r, true)).join('')}</div>` : ''}
				</div>
			</div>
		`;
	};

	list.innerHTML = comments.map((c) => renderOneComment(c, false)).join('');
};

const loadCommentsForCurrent = async () => {
	const list = $('#commentsList');
	if (!list) return;
	if (!currentPlayingVideoId && !currentPlayingVideoUrl) {
		clearCommentsList();
		setCommentsState('Play a YouTube video to load comments.');
		return;
	}
	const sort = ($('#commentsSort')?.value || 'top');
	const token = ++commentsReqToken;
	clearCommentsList();
	setCommentsState('Loading comments...');
	try {
		const base = currentPlayingVideoId
			? `/api/comments?id=${encodeURIComponent(currentPlayingVideoId)}`
			: `/api/comments?url=${encodeURIComponent(currentPlayingVideoUrl)}`;
		const url = `${base}&sort=${encodeURIComponent(sort)}&limit=80`;
		const res = await fetch(url);
		const data = await res.json();
		if (token !== commentsReqToken) return;
		if (!res.ok) {
			throw new Error(data.error || `Request failed (${res.status})`);
		}
		renderComments(data.comments || []);
	} catch (err) {
		if (token !== commentsReqToken) return;
		clearCommentsList();
		setCommentsState(`Failed to load comments: ${err.message || 'Unknown error'}`);
	}
};

$('#commentsSort')?.addEventListener('change', () => {
	loadCommentsForCurrent();
});

const openModal = (msg) => {
	$('#modalMsg').textContent = msg || '';
	showModal($('#modal'));
};
const closeModal = () => { hideModal($('#modal')); };
$('#modalClose')?.addEventListener('click', closeModal);
$('#modal')?.addEventListener('click', (e) => {
	if (e.target === $('#modal')) closeModal();
});

const showWelcome = () => { showEl($('#welcomeState')); };
const hideWelcome = () => { hideEl($('#welcomeState')); };

const clearListUI = () => {
	$('#results').innerHTML = '';
	hideEl($('#pager'));
};

// --- Toast Notifications ---

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

// --- Loading Bar ---

let loadingBarEl = null;
const showLoadingBar = () => {
	if (!loadingBarEl) {
		loadingBarEl = document.createElement('div');
		loadingBarEl.id = 'loadingBar';
		document.body.appendChild(loadingBarEl);
	}
	loadingBarEl.style.width = '0%';
	loadingBarEl.style.display = 'block';
	requestAnimationFrame(() => {
		loadingBarEl.style.width = '70%';
	});
};
const finishLoadingBar = () => {
	if (!loadingBarEl) return;
	loadingBarEl.style.width = '100%';
	setTimeout(() => {
		loadingBarEl.style.display = 'none';
		loadingBarEl.style.width = '0%';
	}, 300);
};

// --- Skeleton Loader ---

const showSkeletons = (count = 8) => {
	hideWelcome();
	const nodes = Array.from({ length: count }).map(() => `
		<div class="card card-skeleton">
			<div class="card-thumb-wrap skeleton"></div>
			<div class="card-info">
				<div class="skeleton" style="height:14px; width:90%; border-radius:6px;"></div>
				<div class="skeleton" style="height:12px; width:60%; margin-top:6px; border-radius:6px;"></div>
			</div>
		</div>
	`).join('');
	$('#results').innerHTML = nodes;
};

// --- Duration Formatter ---

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

// --- Card Rendering ---

const renderCards = (mountNode, items, { onClick } = {}) => {
	items = (items || []).map(v => ({
		...v,
		duration: v.duration || v.duration_string || '',
		channel: v.channel || (v.uploader || ''),
	}));
	mountNode.innerHTML = items.map((v) => `
		<div class="card" data-id="${v.id}" data-title="${encodeURIComponent(v.title)}">
			<div class="card-thumb-wrap">
				<img loading="lazy" src="${v.thumb}" alt="${v.title}" />
				${v.duration ? `<span class="duration-badge">${formatDuration(v.duration)}</span>` : ''}
			</div>
			<div class="card-info">
				<div class="card-title">${v.title}</div>
				<div class="card-channel">${v.channel || ''}</div>
			</div>
		</div>
	`).join('');
	mountNode.querySelectorAll('.card').forEach((el, idx) => {
		el.addEventListener('click', () => {
			Array.from(mountNode.querySelectorAll('.card')).forEach(n => n.classList.remove('active'));
			el.classList.add('active');
			const id = el.getAttribute('data-id');
			const title = decodeURIComponent(el.getAttribute('data-title') || '');
			onClick && onClick({ id, title, el, idx });
		});
	});
};

// --- Player ---

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
				case v.error.MEDIA_ERR_ABORTED:
					errorMsg += 'Video loading was aborted.'; break;
				case v.error.MEDIA_ERR_NETWORK:
					errorMsg += 'Network error occurred while loading video.'; break;
				case v.error.MEDIA_ERR_DECODE:
					errorMsg += 'Video format is not supported or corrupted.'; break;
				case v.error.MEDIA_ERR_SRC_NOT_SUPPORTED:
					errorMsg += 'Video source is not supported or unavailable.'; break;
				default:
					errorMsg += 'Unknown error occurred.';
			}
		} else {
			errorMsg += 'Please try again or check the video URL.';
		}
		openModal(errorMsg);
		hideEl($('#playerWrap'));
		setStatus('Video load failed');
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
					let errorMsg = 'Failed to stream video. ';
					switch (data.type) {
						case window.Hls.ErrorTypes.NETWORK_ERROR:
							errorMsg += 'Network connection issue.'; break;
						case window.Hls.ErrorTypes.MEDIA_ERROR:
							errorMsg += 'Video format or codec issue.'; break;
						default:
							errorMsg += 'Streaming service unavailable.';
					}
					openModal(errorMsg);
					hideEl($('#playerWrap'));
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
	v.play().catch(() => {});

	showEl($('#playerWrap'));
	syncCommentsPanelHeight();
	$('#nowPlaying').textContent = title || '';
	$('#nowChannel').textContent = channel || '';
	$('#openStream').href = src;
	try { document.getElementById('playerWrap').scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch {}
};

const playById = (id, title, channel = '') => {
	currentPlayingVideoId = id || null;
	currentPlayingVideoUrl = id ? `https://www.youtube.com/watch?v=${id}` : null;
	loadCommentsForCurrent();

	const app = loadAppSettings();
	const h = Number(app.resolution || 0);
	const qs = h > 0 ? `&h=${h}` : '';
	const url = `/stream?id=${encodeURIComponent(id)}${qs}`;
	setPlayer(url, title, channel);
	fetch(`/api/formats?id=${encodeURIComponent(id)}`)
		.then(r => r.json())
		.then(data => {
			const sel = $('#videoResolution');
			if (!sel) return;
			const formats = (data && Array.isArray(data.formats)) ? data.formats : [];
			if (formats.length === 0) { hideEl(sel); return; }
			const app = loadAppSettings();
			const cur = Number(app.resolution || 0);
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

// --- App Settings ---

const APP_SETTINGS_KEY = 'ycp_app_settings_v3';
const defaultAppSettings = { onEnd: 'stop', resolution: 0 };
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

// --- Backend Calls ---

const fetchSearchPage = async (q, page) => {
	setStatus(`Search: "${q}" (page ${page})...`);
	showSkeletons(pageSize);
	showLoadingBar();
	try {
		const r = await fetch(`/api/search?q=${encodeURIComponent(q)}&page=${page}`);
		if (!r.ok) throw new Error(`Search failed: ${r.status} ${r.statusText}`);
		return await r.json();
	} catch (err) {
		openModal(`Search error: ${err.message || 'Network or server issue occurred.'}`);
		throw err;
	} finally {
		finishLoadingBar();
	}
};

const fetchPlaylistPage = async (url, page) => {
	const label = listType === 'channel' ? 'Channel' : 'Playlist';
	setStatus(`${label} page ${page}...`);
	$('#results').innerHTML = '<div class="text-sm text-yt-text-secondary py-8 text-center">Loading…</div>';
	showLoadingBar();
	try {
		const r = await fetch(`/api/playlist?url=${encodeURIComponent(url)}&page=${page}`);
		if (!r.ok) throw new Error(`${label} failed: ${r.status} ${r.statusText}`);
		return await r.json();
	} catch (err) {
		openModal(`${label} error: ${err.message || 'Network or server issue occurred.'}`);
		throw err;
	} finally {
		finishLoadingBar();
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
				const globalIdx = (paging.page - 1) * pageSize + idx;
				currentListSource = 'search';
				currentPlaylistIndex = globalIdx;
				currentMode = 'search';
				updatePlayerControls();
				setStatus('Playing from search');
				const channel = el.querySelector('.card-channel')?.textContent || '';
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
		if (paging.page > 1 || paging.hasMore) showEl(p); else hideEl(p);
		$('#pageInfo').textContent = `Page ${paging.page}` + (paging.totalPages ? ` / ${paging.totalPages}` : '');
	} else if (currentMode === 'playlist') {
		if (paging.totalPages > 1) showEl(p); else hideEl(p);
		$('#pageInfo').textContent = `Page ${paging.page} / ${paging.totalPages}`;
	} else {
		hideEl(p);
	}
};

// --- Playlist Playback ---

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
		return;
	}
	const localIdx = globalIdx % pageSize;
	const item = $('#results').querySelectorAll('.card')[localIdx];
	if (item) {
		const id = item.getAttribute('data-id');
		const title = decodeURIComponent(item.getAttribute('data-title') || '');
		const channel = item.querySelector('.card-channel')?.textContent || '';
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
	if (currentListSource === 'search') {
		const isLastOnPage = (currentPlaylistIndex % pageSize) === (pageSize - 1);
		if (isLastOnPage) {
			if (!(paging.hasMore || (paging.totalPages && paging.page < paging.totalPages))) return;
		}
	}
	await playPlaylistIndex(nextIdx);
};
const prevInPlaylist = async () => {
	if (currentPlaylistIndex <= 0) return;
	await playPlaylistIndex(currentPlaylistIndex - 1);
};

// --- Video End Handler ---

$('#player').addEventListener('ended', () => {
	const s = loadAppSettings();
	const onEnd = (s.onEnd || 'stop');

	if (currentMode === 'video' && !playlistUrl && isYouTubeUrl($('#q').value.trim())) {
		return;
	}

	if (currentPlaylistIndex >= 0 && (currentListSource === 'search' || currentListSource === 'playlist')) {
		if (onEnd === 'loop') {
			try { const v = $('#player'); v.currentTime = 0; v.play().catch(() => {}); } catch {}
			return;
		}
		if (onEnd === 'next') { nextInPlaylist(); return; }
		return;
	}

	if (onEnd === 'loop') {
		try { const v = $('#player'); v.currentTime = 0; v.play().catch(() => {}); } catch {}
		return;
	}

	if (onEnd === 'next' && currentListSource === 'search') { nextInPlaylist(); return; }
});

// --- Keyboard Shortcuts ---

document.addEventListener('keydown', (e) => {
	const v = $('#player');
	if (!v || $('#playerWrap').classList.contains('hidden')) return;
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

// --- Input Handling ---

const isYouTubeUrl = (s) => /^https?:\/\/(www\.)?((youtube\.com\/)|(youtu\.be\/))/i.test(s);
const isPlaylistUrl = (s) => /[?&]list=/.test(s);
const isChannelUrl = (s) => /youtube\.com\/(channel\/|@|c\/|user\/)/i.test(s);

const go = async () => {
	const s = $('#q').value.trim();
	if (!s) return;
	hideWelcome();
	if (isYouTubeUrl(s)) {
		if (isPlaylistUrl(s) || isChannelUrl(s)) {
			currentPlayingVideoId = null;
			currentPlayingVideoUrl = null;
			clearCommentsList();
			setCommentsState('Pick a video from the list to view comments.');

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
			currentPlayingVideoId = null;
			currentPlayingVideoUrl = s;
			loadCommentsForCurrent();
			const app = loadAppSettings();
			const h = Number(app.resolution || 0);
			const qs = h > 0 ? `&h=${h}` : '';
			setPlayer(`/stream?url=${encodeURIComponent(s)}${qs}`, 'Custom video', '');
		}
	} else {
		currentPlayingVideoId = null;
		currentPlayingVideoUrl = null;
		clearCommentsList();
		setCommentsState('Comments are shown when a YouTube video is playing.');

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

// --- Clear Search Button ---

const qInput = $('#q');
const btnClear = $('#btnClearSearch');
const updateClearBtn = () => {
	if (!btnClear) return;
	if (qInput && qInput.value.length > 0) {
		btnClear.classList.remove('opacity-0', 'pointer-events-none');
		btnClear.classList.add('opacity-100', 'pointer-events-auto');
	} else {
		btnClear.classList.add('opacity-0', 'pointer-events-none');
		btnClear.classList.remove('opacity-100', 'pointer-events-auto');
	}
};
qInput?.addEventListener('input', updateClearBtn);
btnClear?.addEventListener('click', () => {
	if (qInput) { qInput.value = ''; qInput.focus(); }
	updateClearBtn();
});

// --- Suggestion Chips ---

$$('.suggestion-chip').forEach(chip => {
	chip.addEventListener('click', () => {
		const query = chip.getAttribute('data-query');
		if (query && qInput) {
			qInput.value = query;
			updateClearBtn();
			go();
		}
	});
});

// --- Pagination ---

$('#btnPrevPage').addEventListener('click', async () => {
	if (currentMode === 'search' && paging.page > 1) { setStatus('Searching...'); await renderSearch(paging.page - 1); }
	else if (currentMode === 'playlist' && paging.page > 1) { setStatus(listType === 'channel' ? 'Loading channel...' : 'Loading playlist...'); await renderPlaylist(paging.page - 1); }
});
$('#btnNextPage').addEventListener('click', async () => {
	if (currentMode === 'search' && (paging.hasMore || (paging.totalPages && paging.page < paging.totalPages))) { setStatus('Searching...'); await renderSearch(paging.page + 1); }
	else if (currentMode === 'playlist' && paging.page < paging.totalPages) { setStatus(listType === 'channel' ? 'Loading channel...' : 'Loading playlist...'); await renderPlaylist(paging.page + 1); }
});

// --- Tab Switching ---

const switchTab = (tabName) => {
	currentTab = tabName;
	$$('.tab-btn').forEach(btn => btn.classList.remove('active'));
	$(`#tab${tabName.charAt(0).toUpperCase() + tabName.slice(1)}`)?.classList.add('active');
	$$('.tab-content').forEach(content => content.classList.remove('active'));
	$(`#${tabName}Tab`)?.classList.add('active');
	clearListUI();
	setStatus('');
	setStreamStatus('');
	currentPlayingVideoId = null;
	currentPlayingVideoUrl = null;
	clearCommentsList();
	setCommentsState('Comments are only available while watching YouTube videos.');
	hidePlayer();
};

$('#tabYoutube')?.addEventListener('click', () => switchTab('youtube'));

// --- Streamlink ---

const setStreamStatus = (text) => { const el = $('#streamStatus'); if (el) el.textContent = text || ''; };

const SETTINGS_KEY = 'ycp_stream_settings_v1';
const loadSettings = () => {
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

// --- Settings Modal ---

const openSettings = () => {
	const app = loadAppSettings();
	const sel = $('#optOnEnd');
	if (sel) sel.value = app.onEnd || 'stop';
	const resSel = $('#optResolution');
	if (resSel) resSel.value = String(app.resolution ?? 0);
	showModal($('#settingsModal'));
};
const closeSettings = () => { hideModal($('#settingsModal')); };
$('#btnSettings')?.addEventListener('click', openSettings);
$('#settingsCancel')?.addEventListener('click', closeSettings);
$('#settingsModal')?.addEventListener('click', (e) => {
	if (e.target === $('#settingsModal')) closeSettings();
});
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
	showToast('Settings saved');
});

// --- Delay & Overlay Helpers ---

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
	currentPlayingVideoId = null;
	currentPlayingVideoUrl = null;
	clearCommentsList();
	setCommentsState('Comments are unavailable for Streamlink sources.');

	const v = $('#player');
	try {
		v.controls = false;
		v.setAttribute('controlsList', 'nodownload noplaybackrate noremoteplayback');
		v.setAttribute('disablePictureInPicture', 'true');
	} catch {}

	const minStartBuffer = Math.max(10, Math.min(90, delaySec));
	showStreamLoading(`Buffering ~${minStartBuffer}s at ${delaySec}s behind live…`);

	let overlayTimer = null;
	const clearOverlayTimer = () => { if (overlayTimer) { clearTimeout(overlayTimer); overlayTimer = null; } };
	overlayTimer = setTimeout(() => hideStreamLoading(), 30000);

	if (v._hls) { try { v._hls.destroy(); } catch {} v._hls = null; }

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
		if (Number.isFinite(lastOkTime)) {
			try { v.currentTime = lastOkTime; } catch {}
		}
		if (e && typeof e.preventDefault === 'function') e.preventDefault();
	};
	const onKeyDown = (e) => {
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
		liveSyncDuration: delaySec,
		liveMaxLatencyDuration: delaySec + 10,
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

	hls.on(Hls.Events.ERROR, function (event, data) {
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

	if (!guardHandlersBound) {
		v.addEventListener('seeking', clampForward);
		v.addEventListener('timeupdate', clampForward);
		guardHandlersBound = true;
	}

	showEl($('#playerWrap'));
	syncCommentsPanelHeight();
	$('#nowPlaying').textContent = title || '';
	$('#nowChannel').textContent = channel || '';
	$('#openStream').href = src;
};

const hidePlayer = () => {
	hideEl($('#playerWrap'));
	const pc = $('#playerControls');
	if (pc) hideEl(pc);
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

const playStreamlinkVideo = () => {
	const url = $('#streamUrl').value.trim();

	if (!url) {
		setStreamStatus('Please enter a streaming URL');
		return;
	}

	setStreamStatus('Loading stream...');

	currentMode = 'streamlink';
	currentPlaylistIndex = -1;
	currentPlayingVideoId = null;
	currentPlayingVideoUrl = null;
	clearCommentsList();
	setCommentsState('Comments are unavailable for Streamlink sources.');
	updatePlayerControls();
	clearListUI();

	const delaySec = getDelaySeconds();

	fetch(`/api/streamlink/info?url=${encodeURIComponent(url)}`)
		.then(async response => {
			if (!response.ok) throw new Error(`Server error: ${response.status} ${response.statusText}`);
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

// --- Init ---

window.addEventListener('DOMContentLoaded', async () => {
	setCommentsState('Play a YouTube video to load comments.');
	setCommentsCount(-1);
	syncCommentsPanelHeight();

	try {
		const r = await fetch('/api/version');
		if (!r.ok) throw new Error(`Version API failed: ${r.status}`);
		const data = await r.json();
		if (data && data.version) {
			const versionEl = $('#appVersion');
			if (versionEl) versionEl.textContent = `v${data.version}`;
		}
	} catch (err) {
		console.warn('Failed to load version:', err.message);
	}
});
