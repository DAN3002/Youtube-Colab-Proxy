/**
 * Video player logic – loaded on /watch pages only.
 * Handles: video playback, resolution switching, HLS, keyboard shortcuts,
 * player mode (normal/theater), playlist auto-advance, channel info,
 * quality badge, and recommended videos.
 */

let currentPlayerMode = 'normal';
let currentPlayingVideoId = null;
let currentVideoInfo = null;

// ---------------------------------------------------------------------------
// Player mode (normal / theater)
// ---------------------------------------------------------------------------

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
		const pressed = inTheater && collapsed;
		btn.setAttribute('aria-pressed', pressed ? 'true' : 'false');
		btn.title = pressed ? 'Show sidebar' : 'Hide sidebar';
		const label = btn.querySelector('span');
		if (label) label.textContent = pressed ? 'Show sidebar' : 'Hide sidebar';
	}
};

const movePlayerToTheater = () => {
	const video = $('#player');
	const theaterTarget = document.querySelector('#theaterPlayer .aspect-video');
	if (video && theaterTarget && !theaterTarget.contains(video)) {
		theaterTarget.appendChild(video);
	}
};

const movePlayerToNormal = () => {
	const video = $('#player');
	const normalTarget = document.querySelector('#normalPlayerBox .aspect-video');
	if (video && normalTarget && !normalTarget.contains(video)) {
		normalTarget.appendChild(video);
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

	// Move video element between containers
	if (normalizedMode === 'theater') {
		movePlayerToTheater();
	} else {
		movePlayerToNormal();
	}

	applyTheaterCommentsCollapse();
};

// ---------------------------------------------------------------------------
// Page title update
// ---------------------------------------------------------------------------

const updatePageTitle = (title) => {
	if (title) {
		document.title = `${title} - YouTube Proxy`;
	}
};

// ---------------------------------------------------------------------------
// Channel info update
// ---------------------------------------------------------------------------

const updateChannelInfo = (info) => {
	const channelName = info.channel || '';
	const channelHandle = info.channel_handle || '';

	// Determine the best identifier for API calls and linking
	// channelHandle may be "@Name" or a raw "UCxxxx" channel ID
	const isAtHandle = channelHandle && channelHandle.startsWith('@');
	const linkHandle = channelHandle || '';  // Use whatever we have for linking

	// Update channel name
	const nowChannel = $('#nowChannel');
	if (nowChannel) nowChannel.textContent = channelName;

	// Update channel handle – show @handle only (not raw channel IDs)
	const handleEl = $('#channelHandle');
	if (handleEl) {
		handleEl.textContent = isAtHandle ? channelHandle : '';
	}

	// Update channel link (works with both @handle and UCxxxx)
	const channelLink = $('#channelLink');
	if (channelLink) {
		channelLink.href = linkHandle ? `/channel/${linkHandle}` : '#';
	}

	// Channel avatar – fetch from /api/channel/info for the real avatar URL
	// Works with both @handle and UCxxxx channel IDs
	const avatarImg = $('#channelAvatarImg');
	const avatarIcon = $('#channelAvatarIcon');
	if (avatarImg && linkHandle) {
		fetch(`/api/channel/info?handle=${encodeURIComponent(linkHandle)}`)
			.then(r => r.json())
			.then(data => {
				if (data && data.avatar) {
					// Create a fresh image to avoid cached broken state
					const testImg = new Image();
					testImg.onload = () => {
						avatarImg.src = data.avatar;
						avatarImg.classList.remove('hidden');
						if (avatarIcon) avatarIcon.style.display = 'none';
					};
					testImg.onerror = () => {
						// Keep fallback icon
					};
					testImg.src = data.avatar;
				}
			})
			.catch(() => {});
	}
};

// ---------------------------------------------------------------------------
// Video stats update
// ---------------------------------------------------------------------------

const updateVideoStats = (info) => {
	const statsEl = $('#videoStats');
	if (!statsEl) return;

	const views = info.view_count;
	const likes = info.like_count;
	const date = info.upload_date;

	let hasAny = false;

	const viewsEl = $('#videoViews');
	if (viewsEl && views != null) {
		viewsEl.textContent = `${Number(views).toLocaleString()} views`;
		hasAny = true;
	}

	const likesEl = $('#videoLikes');
	if (likesEl && likes != null) {
		likesEl.innerHTML = `<i class="fa-solid fa-thumbs-up mr-1"></i>${Number(likes).toLocaleString()}`;
		hasAny = true;
	}

	const dateEl = $('#videoDate');
	if (dateEl && date) {
		// Format YYYYMMDD to readable
		const formatted = date.length === 8
			? `${date.substring(0, 4)}-${date.substring(4, 6)}-${date.substring(6, 8)}`
			: date;
		dateEl.textContent = formatted;
		hasAny = true;
	}

	if (hasAny) {
		statsEl.classList.remove('hidden');
		statsEl.classList.add('flex');
	}
};

// ---------------------------------------------------------------------------
// Quality badge
// ---------------------------------------------------------------------------

const updateQualityBadge = (formats, bestAutoHeight, currentResolution) => {
	const badge = $('#qualityBadge');
	const badgeText = $('#qualityBadgeText');
	const resSel = $('#videoResolution');

	if (!badge || !badgeText) return;

	if (formats && formats.length > 0) {
		// Show the select, hide badge
		if (resSel) {
			showEl(resSel);
			badge.classList.add('hidden');
			badge.classList.remove('inline-flex');

			// Build options
			let html = '';
			if (bestAutoHeight > 0) {
				html += `<option value="0">Auto (${bestAutoHeight}p)</option>`;
			} else {
				html += `<option value="0">Auto</option>`;
			}
			html += formats.map(f => `<option value="${f.height}">${f.label}</option>`).join('');
			resSel.innerHTML = html;
			resSel.value = String(currentResolution > 0 ? currentResolution : 0);
			showEl(resSel);
		}
	} else {
		// No formats available, show badge with auto
		if (resSel) hideEl(resSel);
		if (bestAutoHeight > 0) {
			badgeText.textContent = `Auto (${bestAutoHeight}p)`;
		} else {
			badgeText.textContent = 'Auto';
		}
		badge.classList.remove('hidden');
		badge.classList.add('inline-flex');
	}
};

// ---------------------------------------------------------------------------
// Recommended videos
// ---------------------------------------------------------------------------

const renderRecommendations = (recommendations) => {
	const panel = $('#recommendationsPanel');
	const list = $('#recommendationsList');
	const loading = $('#recsLoading');

	if (!panel || !list) return;

	// Remove loading skeletons
	if (loading) loading.remove();

	if (!Array.isArray(recommendations) || recommendations.length === 0) {
		panel.classList.add('hidden');
		return;
	}

	let html = '';
	for (const rec of recommendations) {
		const dur = formatDuration(rec.duration);
		html += `
			<a href="/watch?v=${escapeHtml(rec.id)}" class="rec-item">
				<div class="rec-thumb">
					<div class="aspect-video rounded-lg overflow-hidden bg-yt-bg-elevated">
						<img loading="lazy"
							 src="${escapeHtml(rec.thumb || `/api/thumb/${rec.id}?q=mq`)}"
							 alt=""
							 class="w-full h-full object-cover" />
					</div>
					${dur ? `<span class="absolute bottom-1 right-1 bg-black/80 text-white text-[10px] font-medium px-1 py-0.5 rounded">${escapeHtml(dur)}</span>` : ''}
				</div>
				<div class="flex-1 min-w-0 pt-0.5">
					<div class="text-sm font-medium text-yt-text line-clamp-2 leading-snug">${escapeHtml(rec.title)}</div>
					${rec.channel ? `<div class="text-xs text-yt-text-secondary mt-1">${escapeHtml(rec.channel)}</div>` : ''}
				</div>
			</a>
		`;
	}

	list.innerHTML = html;
	panel.classList.remove('hidden');
	panel.classList.add('block');
};

// ---------------------------------------------------------------------------
// Video playback
// ---------------------------------------------------------------------------

const setPlayer = (src, title, channel = '') => {
	const v = $('#player');
	const isHls = typeof src === 'string' && (src.includes('.m3u8') || src.includes('/streamlink/hls'));

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

	// Update page title
	if (title) updatePageTitle(title);
};

const playById = (id, title, channel = '') => {
	currentPlayingVideoId = id || null;
	const app = loadAppSettings();
	const h = Number(app.resolution || 0);
	const qs = h > 0 ? `&h=${h}` : '';
	const url = `/stream?id=${encodeURIComponent(id)}${qs}`;
	setPlayer(url, title, channel);

	// Show loading state for quality badge
	const badge = $('#qualityBadge');
	const badgeText = $('#qualityBadgeText');
	if (badge && badgeText) {
		badgeText.textContent = 'Loading...';
		badge.classList.remove('hidden');
		badge.classList.add('inline-flex');
	}

	// Show recommendations panel with loading state
	const recsPanel = $('#recommendationsPanel');
	if (recsPanel) {
		recsPanel.classList.remove('hidden');
		recsPanel.classList.add('flex', 'flex-col');
	}

	// Fetch comprehensive video info (includes title, channel, formats, recommendations)
	fetch(`/api/video-info?id=${encodeURIComponent(id)}`)
		.then(r => r.json())
		.then(data => {
			if (!data || data.error) {
				console.warn('video-info error:', data?.error);
				// Fallback: still try to get formats
				fetchFormatsOnly(id, title, channel);
				return;
			}

			currentVideoInfo = data;

			// Record to watch history
			addToWatchHistory({
				id: id,
				title: data.title || title,
				channel: data.channel || channel,
				duration: formatDuration(data.duration || ''),
			});

			// Update title
			const videoTitle = data.title || title;
			const videoChannel = data.channel || channel;
			$('#nowPlaying').textContent = videoTitle;
			updatePageTitle(videoTitle);

			// Update channel info
			updateChannelInfo(data);

			// Update stats
			updateVideoStats(data);

			// Update quality selector
			const formats = data.formats || [];
			const bestAutoHeight = data.best_auto_height || 0;
			const cur = Number(loadAppSettings().resolution || 0);
			updateQualityBadge(formats, bestAutoHeight, cur);

			// Set up resolution change handler
			const sel = $('#videoResolution');
			if (sel) {
				sel.onchange = () => {
					const newH = parseInt(sel.value, 10) || 0;
					saveAppSettings({ ...loadAppSettings(), resolution: newH });
					const qs2 = newH > 0 ? `&h=${newH}` : '';
					setPlayer(`/stream?id=${encodeURIComponent(id)}${qs2}`, videoTitle, videoChannel);
				};
			}

			// Render recommendations
			renderRecommendations(data.recommendations || []);
		})
		.catch((err) => {
			console.warn('video-info fetch failed:', err);
			fetchFormatsOnly(id, title, channel);
		});
};

// Fallback: fetch only formats if video-info fails
const fetchFormatsOnly = (id, title, channel) => {
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
			// Hide quality badge
			const badge = $('#qualityBadge');
			if (badge) {
				badge.classList.add('hidden');
				badge.classList.remove('inline-flex');
			}
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
				return;
			}
			// Or try first recommendation
			const firstRec = document.querySelector('#recommendationsList a');
			if (firstRec) {
				window.location.href = firstRec.href;
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
		const limit = allowed.includes(Number(app.commentsLimit)) ? Number(app.commentsLimit) : 20;
		commentsLimitEl.value = String(limit);
	}
	applyTheaterCommentsCollapse();

	// Start playing video
	if (videoId) {
		playById(videoId, '', '');

		// Load comments
		if (typeof loadCommentsForVideo === 'function') {
			loadCommentsForVideo(videoId);
		}
	}
}
