/**
 * Main application initialization – loaded on every page.
 * Handles: search bar input detection/redirect, settings modal,
 * clear button, version fetch, and modal bindings.
 */

// ---------------------------------------------------------------------------
// Search input handler – detect URLs and redirect to correct page
// ---------------------------------------------------------------------------

function handleSearchSubmit(event) {
	event.preventDefault();
	const input = $('#q');
	if (!input) return false;
	const s = input.value.trim();
	if (!s) return false;

	if (isYouTubeUrl(s)) {
		const vid = extractVideoId(s);
		const list = extractPlaylistId(s);

		if (vid && list) {
			// Video in playlist context
			window.location.href = `/watch?v=${vid}&list=${list}`;
		} else if (vid) {
			// Single video
			window.location.href = `/watch?v=${vid}`;
		} else if (list) {
			// Playlist only
			window.location.href = `/playlist?list=${list}`;
		} else if (isChannelUrl(s)) {
			const handle = extractChannelHandle(s);
			if (handle) {
				window.location.href = `/channel/${handle}`;
			} else {
				window.location.href = `/results?search_query=${encodeURIComponent(s)}`;
			}
		} else {
			// Other YouTube URL – try as search
			window.location.href = `/results?search_query=${encodeURIComponent(s)}`;
		}
	} else {
		// Plain text search
		window.location.href = `/results?search_query=${encodeURIComponent(s)}`;
	}
	return false;
}

// ---------------------------------------------------------------------------
// Clear search button
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
	const qInput = $('#q');
	const btnClear = $('#btnClearSearch');

	const updateClearBtn = () => {
		if (!btnClear || !qInput) return;
		if (qInput.value.length > 0) {
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

	// Init on load
	updateClearBtn();
});

// ---------------------------------------------------------------------------
// Modal bindings
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
	$('#modalClose')?.addEventListener('click', closeModal);
	$('#modal')?.addEventListener('click', (e) => {
		if (e.target === $('#modal')) closeModal();
	});
});

// ---------------------------------------------------------------------------
// Settings Modal
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
	const updateHistoryCountInSettings = () => {
		const countEl = $('#settingsHistoryCount');
		if (countEl) {
			const h = loadWatchHistory();
			const n = h.length;
			countEl.textContent = n === 0 ? 'No videos' : n === 1 ? '1 video' : `${n} videos`;
		}
	};

	const openSettings = () => {
		const app = loadAppSettings();
		const sel = $('#optOnEnd');
		if (sel) sel.value = app.onEnd || 'stop';
		const resSel = $('#optResolution');
		if (resSel) resSel.value = String(app.resolution ?? 0);
		updateHistoryCountInSettings();
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

	// Clear watch history from settings modal
	$('#settingsClearHistory')?.addEventListener('click', () => {
		clearWatchHistory();
		updateHistoryCountInSettings();
		// Also hide the history section on the home page if visible
		const histSection = $('#watchHistorySection');
		if (histSection) histSection.classList.add('hidden');
		showToast('Watch history cleared');
	});
});

// ---------------------------------------------------------------------------
// Version display
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', async () => {
	try {
		const r = await fetch('/api/version');
		if (!r.ok) return;
		const data = await r.json();
		if (data && data.version) {
			const versionEl = $('#appVersion');
			if (versionEl) versionEl.textContent = `v${data.version}`;
		}
	} catch {}
});
