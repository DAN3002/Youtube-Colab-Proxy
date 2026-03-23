/**
 * Comments loading and rendering – loaded on /watch pages only.
 * Top-level comments are fetched first (fast, depth=1, no replies).
 * Replies are lazy-loaded per comment via /api/replies on click.
 */

let commentsReqToken = 0;

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

// ---------------------------------------------------------------------------
// Build HTML for a single comment
// ---------------------------------------------------------------------------

const buildCommentHTML = (c, isReply = false) => {
	const author = escapeHtml(c.author || 'Unknown');
	const text = escapeHtml(c.text || '').replace(/\n/g, '<br>');
	const avatar = c.author_thumbnail ? escapeHtml(c.author_thumbnail) : '';
	const likes = Number(c.like_count || 0);
	const time = formatRelativeTime(c.timestamp);
	const cid = escapeHtml(c.id || '');
	const pinned = c.is_pinned;
	const hearted = c.is_favorited;

	let badges = '';
	if (pinned) badges += '<span class="comment-badge"><i class="fa-solid fa-thumbtack"></i> Pinned</span>';
	if (hearted) badges += '<span class="comment-badge comment-badge-heart"><i class="fa-solid fa-heart"></i></span>';

	let html = `<div class="comment-item ${isReply ? 'comment-item-reply' : ''}" data-cid="${cid}">`;
	html += avatar
		? `<img class="comment-avatar" src="${avatar}" alt="${author}" loading="lazy" />`
		: '<div class="comment-avatar"></div>';
	html += '<div class="comment-body">';
	html += '<div class="comment-meta">';
	html += `<span class="comment-author">${author}</span>`;
	if (time) html += `<span class="comment-time">${time}</span>`;
	if (badges) html += badges;
	html += '</div>';
	html += `<p class="comment-text">${text}</p>`;
	html += '<div class="comment-actions">';
	html += `<span><i class="fa-regular fa-thumbs-up"></i> ${likes.toLocaleString()}</span>`;

	// Every top-level comment gets a "View replies" toggle
	if (!isReply) {
		html += `<button type="button" class="comment-replies-btn" data-cid="${cid}" data-state="closed">`;
		html += '<i class="fa-solid fa-caret-down"></i>';
		html += '<span>View replies</span>';
		html += '</button>';
	}

	html += '</div>'; // .comment-actions

	// Replies container (hidden, populated on click)
	if (!isReply) {
		html += `<div class="comment-replies-wrap hidden" data-parent="${cid}"></div>`;
	}

	html += '</div>'; // .comment-body
	html += '</div>'; // .comment-item
	return html;
};

// ---------------------------------------------------------------------------
// Render top-level comments
// ---------------------------------------------------------------------------

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

	list.innerHTML = comments.map(c => buildCommentHTML(c, false)).join('');

	// Bind all reply buttons
	list.querySelectorAll('.comment-replies-btn').forEach(btn => {
		btn.addEventListener('click', onToggleReplies);
	});
};

// ---------------------------------------------------------------------------
// Toggle / lazy-load replies
// ---------------------------------------------------------------------------

const onToggleReplies = async (e) => {
	const btn = e.currentTarget;
	const cid = btn.getAttribute('data-cid');
	const state = btn.getAttribute('data-state'); // closed | loaded | loading
	const wrap = btn.closest('.comment-body')?.querySelector(`.comment-replies-wrap[data-parent="${cid}"]`);
	if (!wrap) return;

	// Already loaded — just toggle
	if (state === 'loaded') {
		const showing = !wrap.classList.contains('hidden');
		wrap.classList.toggle('hidden');
		const icon = btn.querySelector('i');
		const label = btn.querySelector('span');
		const count = wrap.querySelectorAll('.comment-item-reply').length;
		if (showing) {
			if (icon) icon.className = 'fa-solid fa-caret-down';
			if (label) label.textContent = `View ${count} ${count === 1 ? 'reply' : 'replies'}`;
		} else {
			if (icon) icon.className = 'fa-solid fa-caret-up';
			if (label) label.textContent = `Hide ${count} ${count === 1 ? 'reply' : 'replies'}`;
		}
		return;
	}

	// Already loading — ignore double-click
	if (state === 'loading') return;

	// Fetch replies
	btn.setAttribute('data-state', 'loading');
	const icon = btn.querySelector('i');
	const label = btn.querySelector('span');
	if (icon) icon.className = 'fa-solid fa-spinner fa-spin';
	if (label) label.textContent = 'Loading...';

	try {
		const videoId = currentPlayingVideoId;
		if (!videoId) throw new Error('No video');

		const res = await fetch(
			`/api/replies?id=${encodeURIComponent(videoId)}&comment_id=${encodeURIComponent(cid)}`
		);
		const data = await res.json();
		if (!res.ok) throw new Error(data.error || `Error ${res.status}`);

		const replies = data.replies || [];
		if (replies.length === 0) {
			wrap.innerHTML = '<div class="text-xs text-yt-text-secondary py-2 pl-9">No replies</div>';
		} else {
			wrap.innerHTML = replies.map(r => buildCommentHTML(r, true)).join('');
		}

		wrap.classList.remove('hidden');
		btn.setAttribute('data-state', 'loaded');

		const count = replies.length;
		if (icon) icon.className = 'fa-solid fa-caret-up';
		if (label) label.textContent = count > 0
			? `Hide ${count} ${count === 1 ? 'reply' : 'replies'}`
			: 'No replies';
	} catch (err) {
		btn.setAttribute('data-state', 'closed');
		if (icon) icon.className = 'fa-solid fa-caret-down';
		if (label) label.textContent = 'Failed — retry';
		console.error('Replies error:', err);
	}
};

// ---------------------------------------------------------------------------
// Load comments for a video
// ---------------------------------------------------------------------------

const loadCommentsForVideo = async (videoId) => {
	if (!videoId) {
		clearCommentsList();
		setCommentsState('No video to load comments for.');
		return;
	}

	const sort = ($('#commentsSort')?.value || 'top');
	const app = loadAppSettings();
	const limitRaw = Number($('#commentsLimit')?.value || app.commentsLimit || 20);
	const allowed = [10, 20, 50, 70, 100];
	const limit = allowed.includes(limitRaw) ? limitRaw : 20;
	const token = ++commentsReqToken;
	clearCommentsList();
	setCommentsState('Loading comments...');

	try {
		const url = `/api/comments?id=${encodeURIComponent(videoId)}&sort=${encodeURIComponent(sort)}&limit=${limit}`;
		const res = await fetch(url);
		const data = await res.json();
		if (token !== commentsReqToken) return;
		if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
		renderComments(data.comments || []);
	} catch (err) {
		if (token !== commentsReqToken) return;
		clearCommentsList();
		setCommentsState(`Failed to load comments: ${err.message || 'Unknown error'}`);
	}
};

// ---------------------------------------------------------------------------
// Bind controls
// ---------------------------------------------------------------------------

document.addEventListener('DOMContentLoaded', () => {
	$('#commentsSort')?.addEventListener('change', () => {
		if (currentPlayingVideoId) loadCommentsForVideo(currentPlayingVideoId);
	});

	$('#commentsLimit')?.addEventListener('change', () => {
		const allowed = [10, 20, 50, 70, 100];
		const raw = Number($('#commentsLimit')?.value || 20);
		const commentsLimit = allowed.includes(raw) ? raw : 20;
		saveAppSettings({ ...loadAppSettings(), commentsLimit });
		if (currentPlayingVideoId) loadCommentsForVideo(currentPlayingVideoId);
	});
});
