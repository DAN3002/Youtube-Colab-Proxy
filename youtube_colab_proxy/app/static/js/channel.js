/**
 * Channel page – client-side rendering.
 *
 * Loads channel info, videos, playlists, and search results via API calls.
 * No full channel data is loaded server-side, so large channels load fast.
 */

(function () {
	'use strict';

	// -----------------------------------------------------------------------
	// DOM references
	// -----------------------------------------------------------------------

	const app = $('#channelApp');
	if (!app) return;

	const handle = (app.dataset.handle || '').trim();
	if (!handle) return;

	// Header
	const elBannerWrap    = $('#channelBannerWrap');
	const elBanner        = $('#channelBanner');
	const elAvatarWrap    = $('#channelAvatarWrap');
	const elAvatarFallback = $('#channelAvatarFallback');
	const elAvatar        = $('#channelAvatar');
	const elTitleSkeleton = $('#channelTitleSkeleton');
	const elTitle         = $('#channelTitle');
	const elHandle        = $('#channelHandle');
	const elYTLink        = $('#channelYTLink');

	// Tabs
	const tabButtons      = $$('.channel-tab');

	// Search
	const elSearchInput   = $('#channelSearchInput');
	const elSearchClear   = $('#channelSearchClear');
	const elSearchIndicator = $('#searchIndicator');
	const elSearchLabel   = $('#searchQueryLabel');
	const elClearSearchBtn = $('#clearSearchBtn');

	// Content
	const elSkeleton      = $('#contentSkeleton');
	const elVideosGrid    = $('#videosGrid');
	const elPlaylistsGrid = $('#playlistsGrid');
	const elEmptyState    = $('#emptyState');
	const elEmptyIcon     = $('#emptyIcon');
	const elEmptyTitle    = $('#emptyTitle');
	const elEmptySubtitle = $('#emptySubtitle');
	const elErrorState    = $('#errorState');
	const elErrorMessage  = $('#errorMessage');
	const elRetryBtn      = $('#retryBtn');

	// Pagination
	const elPagination    = $('#pagination');
	const elPrevBtn       = $('#prevBtn');
	const elNextBtn       = $('#nextBtn');
	const elPageInfo      = $('#pageInfo');

	// -----------------------------------------------------------------------
	// State
	// -----------------------------------------------------------------------

	let currentTab = 'videos';   // 'videos' | 'playlists'
	let currentPage = 1;
	let searchQuery = '';
	let searchDebounceTimer = null;
	let isLoading = false;
	let channelInfoLoaded = false;

	// -----------------------------------------------------------------------
	// API helpers
	// -----------------------------------------------------------------------

	async function apiFetch(endpoint, params = {}) {
		const url = new URL(endpoint, window.location.origin);
		Object.entries(params).forEach(([k, v]) => {
			if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
		});
		const resp = await fetch(url.toString());
		const data = await resp.json();
		if (!resp.ok && data.error) throw new Error(data.error);
		return data;
	}

	// -----------------------------------------------------------------------
	// Channel info (header)
	// -----------------------------------------------------------------------

	async function loadChannelInfo() {
		if (channelInfoLoaded) return;
		try {
			const data = await apiFetch('/api/channel/info', { handle });

			// Banner
			if (data.banner && elBanner && elBannerWrap) {
				elBanner.src = data.banner;
				elBanner.onload = () => showEl(elBannerWrap);
				elBanner.onerror = () => {}; // Keep hidden on error
			}

			// Title
			hideEl(elTitleSkeleton);
			elTitle.textContent = data.title || handle;
			showEl(elTitle);

			// Handle – update from API (resolves UCxxxx → @RealHandle)
			if (data.handle && elHandle) {
				elHandle.textContent = data.handle;
			}

			// Avatar
			if (data.avatar) {
				elAvatar.src = data.avatar;
				elAvatar.onload = () => {
					hideEl(elAvatarFallback);
					elAvatar.classList.remove('hidden');
				};
				elAvatar.onerror = () => {
					// Keep fallback icon visible
				};
			}

			// YouTube link
			if (data.channel_url) {
				elYTLink.href = data.channel_url;
				showEl(elYTLink);
			}

			// Update page title
			if (data.title) {
				document.title = `${data.title} - YouTube Proxy`;
			}

			channelInfoLoaded = true;
		} catch (err) {
			// Non-critical – header keeps skeleton/fallback
			hideEl(elTitleSkeleton);
			elTitle.textContent = handle;
			showEl(elTitle);
		}
	}

	// -----------------------------------------------------------------------
	// Render helpers
	// -----------------------------------------------------------------------

	function renderVideoCard(item) {
		const href = `/watch?v=${escapeHtml(item.id)}`;
		const duration = formatDuration(item.duration);
		return `
		<a href="${href}" class="card group block">
			<div class="card-thumb-wrap">
				<img loading="lazy" src="${escapeHtml(item.thumb)}" alt="${escapeHtml(item.title)}" class="w-full h-full object-cover" />
				${duration ? `<span class="duration-badge">${escapeHtml(duration)}</span>` : ''}
			</div>
			<div class="card-info">
				<div class="card-title">${escapeHtml(item.title)}</div>
				${item.channel ? `<div class="card-channel">${escapeHtml(item.channel)}</div>` : ''}
			</div>
		</a>`;
	}

	function renderPlaylistCard(item) {
		const href = `/playlist?list=${escapeHtml(item.id)}`;
		const thumbSrc = item.thumb || '';
		const countLabel = item.videoCount
			? `${item.videoCount} video${item.videoCount !== 1 ? 's' : ''}`
			: '';
		return `
		<a href="${href}" class="card group block">
			<div class="card-thumb-wrap relative">
				${thumbSrc
					? `<img loading="lazy" src="${escapeHtml(thumbSrc)}" alt="${escapeHtml(item.title)}" class="w-full h-full object-cover" />`
					: `<div class="w-full h-full flex items-center justify-center bg-yt-bg-elevated">
						<i class="fa-solid fa-list text-yt-text-secondary text-3xl"></i>
					   </div>`
				}
				${countLabel ? `<span class="duration-badge"><i class="fa-solid fa-list text-[10px] mr-1"></i>${escapeHtml(countLabel)}</span>` : ''}
			</div>
			<div class="card-info">
				<div class="card-title">${escapeHtml(item.title)}</div>
				${countLabel ? `<div class="card-channel">${escapeHtml(countLabel)}</div>` : ''}
			</div>
		</a>`;
	}

	// -----------------------------------------------------------------------
	// UI state management
	// -----------------------------------------------------------------------

	function showSkeleton() {
		showEl(elSkeleton);
		hideEl(elVideosGrid);
		hideEl(elPlaylistsGrid);
		hideEl(elEmptyState);
		hideEl(elErrorState);
		hideEl(elPagination);
	}

	function showContent() {
		hideEl(elSkeleton);
		hideEl(elEmptyState);
		hideEl(elErrorState);
	}

	function showEmpty(icon, title, subtitle) {
		hideEl(elSkeleton);
		hideEl(elVideosGrid);
		hideEl(elPlaylistsGrid);
		hideEl(elErrorState);
		hideEl(elPagination);
		elEmptyIcon.className = `fa-solid ${icon} text-yt-text-secondary text-xl`;
		elEmptyTitle.textContent = title;
		elEmptySubtitle.textContent = subtitle;
		showEl(elEmptyState);
	}

	function showError(msg) {
		hideEl(elSkeleton);
		hideEl(elVideosGrid);
		hideEl(elPlaylistsGrid);
		hideEl(elEmptyState);
		hideEl(elPagination);
		elErrorMessage.textContent = msg;
		showEl(elErrorState);
	}

	function updatePagination(page, hasMore) {
		if (page <= 1 && !hasMore) {
			hideEl(elPagination);
			return;
		}
		showEl(elPagination);
		elPrevBtn.disabled = page <= 1;
		elPrevBtn.classList.toggle('opacity-40', page <= 1);
		elPrevBtn.classList.toggle('cursor-not-allowed', page <= 1);
		elNextBtn.disabled = !hasMore;
		elNextBtn.classList.toggle('opacity-40', !hasMore);
		elNextBtn.classList.toggle('cursor-not-allowed', !hasMore);
		elPageInfo.textContent = `Page ${page}`;
	}

	// -----------------------------------------------------------------------
	// Data loaders
	// -----------------------------------------------------------------------

	async function loadVideos(page) {
		if (isLoading) return;
		isLoading = true;
		showSkeleton();

		try {
			const data = await apiFetch('/api/channel/videos', { handle, page });
			const items = data.items || [];

			if (items.length === 0) {
				showEmpty('fa-video', 'No videos found', 'This channel has no uploaded videos.');
			} else {
				showContent();
				elVideosGrid.innerHTML = items.map(renderVideoCard).join('');
				showEl(elVideosGrid);
				hideEl(elPlaylistsGrid);
				updatePagination(page, data.hasMore);
			}
			currentPage = page;
		} catch (err) {
			showError(err.message || 'Failed to load videos');
		} finally {
			isLoading = false;
		}
	}

	async function loadPlaylists(page) {
		if (isLoading) return;
		isLoading = true;
		showSkeleton();

		try {
			const data = await apiFetch('/api/channel/playlists', { handle, page });
			const items = data.items || [];

			if (items.length === 0) {
				showEmpty('fa-list', 'No playlists found', 'This channel has no public playlists.');
			} else {
				showContent();
				elPlaylistsGrid.innerHTML = items.map(renderPlaylistCard).join('');
				hideEl(elVideosGrid);
				showEl(elPlaylistsGrid);
				updatePagination(page, data.hasMore);
			}
			currentPage = page;
		} catch (err) {
			showError(err.message || 'Failed to load playlists');
		} finally {
			isLoading = false;
		}
	}

	async function loadSearch(query, page) {
		if (isLoading) return;
		isLoading = true;
		showSkeleton();

		try {
			const data = await apiFetch('/api/channel/search', { handle, q: query, page });
			const items = data.items || [];

			if (items.length === 0) {
				showEmpty('fa-magnifying-glass', 'No results', `No videos matched "${query}" in this channel.`);
			} else {
				showContent();
				elVideosGrid.innerHTML = items.map(renderVideoCard).join('');
				showEl(elVideosGrid);
				hideEl(elPlaylistsGrid);
				updatePagination(page, data.hasMore);
			}
			currentPage = page;
		} catch (err) {
			showError(err.message || 'Search failed');
		} finally {
			isLoading = false;
		}
	}

	// -----------------------------------------------------------------------
	// Main loader (dispatches based on state)
	// -----------------------------------------------------------------------

	function loadCurrentView(page = 1) {
		// Scroll to top of content when changing pages/tabs
		if (page !== currentPage || currentTab) {
			app.scrollIntoView({ behavior: 'smooth', block: 'start' });
		}

		if (searchQuery) {
			loadSearch(searchQuery, page);
		} else if (currentTab === 'playlists') {
			loadPlaylists(page);
		} else {
			loadVideos(page);
		}
	}

	// -----------------------------------------------------------------------
	// Tab switching
	// -----------------------------------------------------------------------

	function switchTab(tab) {
		if (tab === currentTab && !searchQuery) return;

		currentTab = tab;
		currentPage = 1;
		searchQuery = '';
		elSearchInput.value = '';
		updateSearchClearBtn();
		hideEl(elSearchIndicator);

		// Update tab active states
		tabButtons.forEach((btn) => {
			const isActive = btn.dataset.tab === tab;
			btn.classList.toggle('is-active', isActive);
		});

		loadCurrentView(1);
	}

	tabButtons.forEach((btn) => {
		btn.addEventListener('click', () => switchTab(btn.dataset.tab));
	});

	// -----------------------------------------------------------------------
	// Search
	// -----------------------------------------------------------------------

	function updateSearchClearBtn() {
		const hasValue = elSearchInput.value.trim().length > 0;
		elSearchClear.classList.toggle('opacity-0', !hasValue);
		elSearchClear.classList.toggle('pointer-events-none', !hasValue);
		elSearchClear.classList.toggle('opacity-100', hasValue);
		elSearchClear.classList.toggle('pointer-events-auto', hasValue);
	}

	elSearchInput.addEventListener('input', () => {
		updateSearchClearBtn();
		clearTimeout(searchDebounceTimer);
		searchDebounceTimer = setTimeout(() => {
			const q = elSearchInput.value.trim();
			if (q && q.length >= 2) {
				searchQuery = q;
				currentPage = 1;
				elSearchLabel.textContent = q;
				showEl(elSearchIndicator);
				// Switch to videos tab for search results
				currentTab = 'videos';
				tabButtons.forEach((btn) => {
					btn.classList.toggle('is-active', btn.dataset.tab === 'videos');
				});
				loadSearch(q, 1);
			} else if (!q && searchQuery) {
				// Cleared search – reload current tab
				searchQuery = '';
				hideEl(elSearchIndicator);
				loadCurrentView(1);
			}
		}, 500);
	});

	elSearchInput.addEventListener('keydown', (e) => {
		if (e.key === 'Enter') {
			e.preventDefault();
			clearTimeout(searchDebounceTimer);
			const q = elSearchInput.value.trim();
			if (q) {
				searchQuery = q;
				currentPage = 1;
				elSearchLabel.textContent = q;
				showEl(elSearchIndicator);
				currentTab = 'videos';
				tabButtons.forEach((btn) => {
					btn.classList.toggle('is-active', btn.dataset.tab === 'videos');
				});
				loadSearch(q, 1);
			}
		}
	});

	elSearchClear.addEventListener('click', () => {
		elSearchInput.value = '';
		elSearchInput.focus();
		updateSearchClearBtn();
		if (searchQuery) {
			searchQuery = '';
			hideEl(elSearchIndicator);
			loadCurrentView(1);
		}
	});

	elClearSearchBtn.addEventListener('click', () => {
		searchQuery = '';
		elSearchInput.value = '';
		updateSearchClearBtn();
		hideEl(elSearchIndicator);
		loadCurrentView(1);
	});

	// -----------------------------------------------------------------------
	// Pagination
	// -----------------------------------------------------------------------

	elPrevBtn.addEventListener('click', () => {
		if (currentPage > 1) loadCurrentView(currentPage - 1);
	});

	elNextBtn.addEventListener('click', () => {
		loadCurrentView(currentPage + 1);
	});

	// -----------------------------------------------------------------------
	// Retry
	// -----------------------------------------------------------------------

	elRetryBtn.addEventListener('click', () => {
		loadCurrentView(currentPage);
	});

	// -----------------------------------------------------------------------
	// Tab active style (via CSS)
	// -----------------------------------------------------------------------

	const style = document.createElement('style');
	style.textContent = `
		.channel-tab {
			color: #aaa;
			background: transparent;
			border: none;
			cursor: pointer;
		}
		.channel-tab:hover {
			color: #f1f1f1;
			background: rgba(255,255,255,0.06);
		}
		.channel-tab.is-active {
			color: #0f0f0f;
			background: #f1f1f1;
		}
	`;
	document.head.appendChild(style);

	// -----------------------------------------------------------------------
	// Init
	// -----------------------------------------------------------------------

	loadChannelInfo();
	loadVideos(1);

})();
