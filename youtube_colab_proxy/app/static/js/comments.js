/**
 * Comments loading and rendering – loaded on /watch pages only.
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

const loadCommentsForVideo = async (videoId) => {
	if (!videoId) {
		clearCommentsList();
		setCommentsState('No video to load comments for.');
		return;
	}

	const sort = ($('#commentsSort')?.value || 'top');
	const app = loadAppSettings();
	const limitRaw = Number($('#commentsLimit')?.value || app.commentsLimit || 50);
	const allowed = [10, 20, 50, 70, 100];
	const limit = allowed.includes(limitRaw) ? limitRaw : 50;
	const token = ++commentsReqToken;
	clearCommentsList();
	setCommentsState('Loading comments...');

	try {
		const url = `/api/comments?id=${encodeURIComponent(videoId)}&sort=${encodeURIComponent(sort)}&limit=${limit}`;
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

// Bind controls
document.addEventListener('DOMContentLoaded', () => {
	$('#commentsSort')?.addEventListener('change', () => {
		if (currentPlayingVideoId) {
			loadCommentsForVideo(currentPlayingVideoId);
		}
	});

	$('#commentsLimit')?.addEventListener('change', () => {
		const allowed = [10, 20, 50, 70, 100];
		const raw = Number($('#commentsLimit')?.value || 50);
		const commentsLimit = allowed.includes(raw) ? raw : 50;
		saveAppSettings({ ...loadAppSettings(), commentsLimit });
		if (currentPlayingVideoId) {
			loadCommentsForVideo(currentPlayingVideoId);
		}
	});
});
