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

const hidePlayer = () => {
	$('#playerWrap').style.display = 'none';
	$('#playerControls').style.display = 'none';
};

// Quality selection removed: always use 'best'

const loadStreamInfo = async () => {
	const url = $('#streamUrl').value.trim();
	if (!url) {
		setStreamStatus('Please enter a streaming URL');
		return;
	}
	
	setStreamStatus('Checking stream...');
	
	try {
		const response = await fetch(`/api/streamlink/info?url=${encodeURIComponent(url)}`);
		const data = await response.json();
		
		if (!data.supported) {
			setStreamStatus(data.error || 'Stream not supported or unavailable');
			$('#streamQualitySelect').style.display = 'none';
			return;
		}
		
		if (data.supported) {
			setStreamStatus(`Stream loaded: ${data.title} by ${data.author}`);
		} else {
			setStreamStatus('Stream unavailable');
		}
		
	} catch (error) {
		setStreamStatus(`Error: ${error.message}`);
		$('#streamQualitySelect').style.display = 'none';
	}
};

const playStreamlinkVideo = () => {
	const url = $('#streamUrl').value.trim();
	
	if (!url) {
		setStreamStatus('Please enter a streaming URL');
		return;
	}
	
	currentMode = 'streamlink';
	currentPlaylistIndex = -1;
	updatePlayerControls();
	clearListUI();
	
	// Get stream info for title display, then play via HLS manifest proxy
	fetch(`/api/streamlink/info?url=${encodeURIComponent(url)}`)
		.then(response => response.json())
		.then(data => {
			const title = data.supported ? data.title : 'Streaming Video';
			const author = data.supported ? data.author : 'Unknown';
			const manifest = `/streamlink/hls?url=${encodeURIComponent(url)}`;
			setPlayer(manifest, title, author);
			setStreamStatus('Playing stream...');
		})
		.catch(error => {
			const manifest = `/streamlink/hls?url=${encodeURIComponent(url)}`;
			setPlayer(manifest, 'Streaming Video', 'Unknown');
			setStreamStatus('Playing stream...');
		});
};

$('#btnStreamGo').addEventListener('click', loadStreamInfo);
$('#btnPlayStream').addEventListener('click', playStreamlinkVideo);
$('#streamUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadStreamInfo(); }); 
