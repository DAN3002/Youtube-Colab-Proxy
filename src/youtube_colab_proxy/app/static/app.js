const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => Array.from(document.querySelectorAll(sel));

let playlistMeta = { url: '', page: 1, totalPages: 1, total: 0, pageSize: 8 };
let playlistItems = [];
let currentPlaylistIndex = -1; // global index across pages

const updatePlayerControls = () => {
	$('#playerControls').style.display = currentPlaylistIndex >= 0 ? 'flex' : 'none';
};

// Tabs
$$('.tab').forEach((t) => {
	t.addEventListener('click', () => {
		$$('.tab').forEach((x) => x.classList.remove('active'));
		t.classList.add('active');
		const tab = t.dataset.tab;
		$('#panel-search').style.display = tab === 'search' ? 'block' : 'none';
		$('#panel-video').style.display = tab === 'video' ? 'block' : 'none';
		$('#panel-playlist').style.display = tab === 'playlist' ? 'block' : 'none';
	});
});

// Generic grid renderer
const renderCards = (mountNode, items, {onClick} = {}) => {
	mountNode.innerHTML = items.map((v) => `
		<div class="card" data-id="${v.id}" data-title="${encodeURIComponent(v.title)}">
			<img class="thumb" loading="lazy" src="${v.thumb}" alt="${v.title}" />
			<div style="margin-top:8px; font-weight:600;">${v.title}</div>
			<div class="muted">${v.channel || ''}</div>
			<div class="muted">${v.duration || ''}</div>
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

// Search
const doSearch = async () => {
	const q = $('#q').value.trim();
	if (!q) return;
	$('#results').innerHTML = '<div class="muted">Searching…</div>';
	try {
		const r = await fetch(`/api/search?q=${encodeURIComponent(q)}`);
		const j = await r.json();
		renderCards($('#results'), (j.items || []), {
			onClick: ({ id, title }) => {
				currentPlaylistIndex = -1;
				updatePlayerControls();
				setPlayer(`/stream?id=${encodeURIComponent(id)}`, title);
			}
		});
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
	currentPlaylistIndex = -1;
	updatePlayerControls();
	setPlayer(`/stream?url=${encodeURIComponent(u)}`, 'Custom video');
};
$('#btnPlayUrl').addEventListener('click', playUrl);
$('#videoUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') playUrl(); });

// Backend playlist pagination
const renderPlaylistPage = async (page) => {
	const u = playlistMeta.url;
	if (!u) return;
	$('#plist').innerHTML = '<div class="muted">Loading…</div>';
	try {
		const r = await fetch(`/api/playlist?url=${encodeURIComponent(u)}&page=${page}`);
		const j = await r.json();
		if (j.error) {
			$('#plist').innerHTML = `<div class=\"muted\">${j.error}</div>`;
			return;
		}
		playlistMeta.page = j.page;
		playlistMeta.totalPages = j.totalPages;
		playlistMeta.total = j.total;
		playlistMeta.pageSize = j.pageSize;
		playlistItems = j.items || [];
		renderCards($('#plist'), playlistItems, {
			onClick: ({ idx }) => {
				const globalIdx = (playlistMeta.page - 1) * playlistMeta.pageSize + idx;
				playPlaylistIndex(globalIdx);
			}
		});
		// highlight active if visible
		Array.from($('#plist').querySelectorAll('.card')).forEach((el, i) => {
			const globalIdx = (playlistMeta.page - 1) * playlistMeta.pageSize + i;
			if (globalIdx === currentPlaylistIndex) el.classList.add('active');
			else el.classList.remove('active');
		});
		$('#plistPager').style.display = playlistMeta.totalPages > 1 ? 'flex' : 'none';
		$('#plPageInfo').textContent = `Page ${playlistMeta.page} / ${playlistMeta.totalPages}`;
	} catch (e) {
		$('#plist').innerHTML = `<div class="muted">Failed: ${e}</div>`;
	}
};

const loadPlaylist = async () => {
	const u = $('#playlistUrl').value.trim();
	if (!u) return;
	playlistMeta.url = u;
	currentPlaylistIndex = -1;
	updatePlayerControls();
	await renderPlaylistPage(1);
};
$('#btnLoadList').addEventListener('click', loadPlaylist);
$('#playlistUrl').addEventListener('keydown', (e) => { if (e.key === 'Enter') loadPlaylist(); });
$('#btnPlPrevPage').addEventListener('click', () => {
	if (playlistMeta.page > 1) renderPlaylistPage(playlistMeta.page - 1);
});
$('#btnPlNextPage').addEventListener('click', () => {
	if (playlistMeta.page < playlistMeta.totalPages) renderPlaylistPage(playlistMeta.page + 1);
});

// Player helpers
const setPlayer = (src, title) => {
	const v = $('#player');
	v.src = src;
	v.currentTime = 0;
	v.play().catch(() => {});
	$('#playerWrap').style.display = 'block';
	$('#nowPlaying').textContent = title || '';
	$('#openStream').href = src;
};

const playById = (id, title) => setPlayer(`/stream?id=${encodeURIComponent(id)}`, title);

const playPlaylistIndex = async (globalIdx) => {
	const total = playlistMeta.total;
	if (globalIdx < 0 || globalIdx >= total) return;
	currentPlaylistIndex = globalIdx;
	updatePlayerControls();
	const page = Math.floor(globalIdx / playlistMeta.pageSize) + 1;
	if (page !== playlistMeta.page) {
		await renderPlaylistPage(page);
	}
	const localIdx = globalIdx % playlistMeta.pageSize;
	const item = $('#plist').querySelectorAll('.card')[localIdx];
	if (item) {
		const id = item.getAttribute('data-id');
		const title = decodeURIComponent(item.getAttribute('data-title') || '');
		playById(id, title);
	}
	// re-highlight
	Array.from($('#plist').querySelectorAll('.card')).forEach((el, i) => {
		const gi = (playlistMeta.page - 1) * playlistMeta.pageSize + i;
		if (gi === currentPlaylistIndex) el.classList.add('active'); else el.classList.remove('active');
	});
};

const nextInPlaylist = async () => {
	if (currentPlaylistIndex < 0) return;
	const next = currentPlaylistIndex + 1;
	if (next < playlistMeta.total) await playPlaylistIndex(next);
};

const prevInPlaylist = async () => {
	if (currentPlaylistIndex <= 0) return;
	const prev = currentPlaylistIndex - 1;
	await playPlaylistIndex(prev);
};

$('#btnPrev').addEventListener('click', prevInPlaylist);
$('#btnNext').addEventListener('click', nextInPlaylist);

// Auto play next when ended
$('#player').addEventListener('ended', () => {
	if (currentPlaylistIndex >= 0 && currentPlaylistIndex + 1 < playlistMeta.total) {
		nextInPlaylist();
	}
}); 
