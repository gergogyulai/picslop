<script lang="ts">
	import { afterNavigate, goto, invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import CommentThread from '$lib/components/CommentThread.svelte';
	import EmojiPicker from '$lib/components/EmojiPicker.svelte';
	import VoteButtons from '$lib/components/VoteButtons.svelte';
	import { COMMENT_MAX, QUICK_REACTIONS, type CommentView } from '$lib/constants';
	import { formatDuration, timeAgo } from '$lib/format';
	import { toast, toastError } from '$lib/toast.svelte';

	let { data } = $props();

	// Local, deeply reactive copies for optimistic UI; re-created when navigating to another post.
	let post = $derived.by(() => {
		const p = $state(structuredClone(data.post));
		return p;
	});
	let comments = $derived.by(() => {
		const list = $state<CommentView[]>(structuredClone(data.comments));
		return list;
	});
	let commentCount = $derived(data.post.comments);

	// Thread structure: top-level comments plus replies grouped by parent, both in creation order.
	const thread = $derived.by(() => {
		const ids = new Set(comments.map((c) => c.id));
		const childrenOf = new Map<string, CommentView[]>();
		const top: CommentView[] = [];
		for (const c of comments) {
			if (c.parentId && ids.has(c.parentId)) {
				const list = childrenOf.get(c.parentId);
				if (list) list.push(c);
				else childrenOf.set(c.parentId, [c]);
			} else {
				top.push(c);
			}
		}
		return { top, childrenOf };
	});

	// "Back" should return to the exact scroll position on the board when we came from inside the app.
	let cameFromApp = false;
	afterNavigate(({ from }) => {
		cameFromApp = !!from;
	});
	function back(e: MouseEvent) {
		if (cameFromApp) {
			e.preventDefault();
			history.back();
		}
	}

	// Double-tap (or double-click) the image to upvote.
	let votes = $state<ReturnType<typeof VoteButtons>>();
	let burst = $state(0);
	let lastTap = { t: 0, x: 0, y: 0 };
	function like() {
		votes?.upvote();
		burst++;
	}
	function onMediaPointerUp(e: PointerEvent) {
		if (e.pointerType === 'mouse') return; // mouse uses dblclick
		const now = e.timeStamp;
		const near = Math.hypot(e.clientX - lastTap.x, e.clientY - lastTap.y) < 30;
		if (now - lastTap.t < 320 && near) {
			like();
			lastTap = { t: 0, x: 0, y: 0 };
		} else {
			lastTap = { t: now, x: e.clientX, y: e.clientY };
		}
	}

	const me = $derived(page.data.user!);
	const isAdmin = $derived(page.data.isAdmin as boolean);

	let body = $state('');
	let sending = $state(false);
	let reacting = $state<Set<string>>(new Set());
	let popped = $state<string | null>(null);

	// Quick reactions always show (in a fixed order); any other emoji shows once someone has used it.
	const quick: readonly string[] = QUICK_REACTIONS;
	const extraReactions = $derived(Object.keys(post.reactions).filter((e) => !quick.includes(e)));

	function applyCount(emoji: string, count: number) {
		if (count > 0) post.reactions[emoji] = count;
		else delete post.reactions[emoji];
	}

	async function react(emoji: string) {
		if (reacting.has(emoji)) return;
		const had = post.myReactions.includes(emoji);
		const before = post.reactions[emoji] ?? 0;
		applyCount(emoji, before + (had ? -1 : 1));
		post.myReactions = had ? post.myReactions.filter((r) => r !== emoji) : [...post.myReactions, emoji];
		if (!had) popped = emoji;
		reacting.add(emoji);
		reacting = new Set(reacting);
		try {
			const res = await api<{ on: boolean; count: number }>(`/api/posts/${post.id}/react`, { body: { emoji } });
			applyCount(emoji, res.count);
			post.myReactions = res.on
				? [...new Set([...post.myReactions, emoji])]
				: post.myReactions.filter((r) => r !== emoji);
		} catch (e) {
			applyCount(emoji, before);
			post.myReactions = had ? [...post.myReactions, emoji] : post.myReactions.filter((r) => r !== emoji);
			toastError(e);
		} finally {
			reacting.delete(emoji);
			reacting = new Set(reacting);
		}
	}

	/** From the picker: react, or just point at it if it's already yours (picking shouldn't un-react). */
	function pick(emoji: string) {
		if (post.myReactions.includes(emoji)) {
			popped = emoji;
			return;
		}
		react(emoji);
	}

	async function postComment(text: string, parentId?: string) {
		try {
			const res = await api<{ comment: CommentView; count: number }>(`/api/posts/${post.id}/comments`, {
				body: { body: text, parentId }
			});
			comments = [...comments, res.comment];
			commentCount = res.count;
			return true;
		} catch (e) {
			toastError(e);
			return false;
		}
	}

	async function comment(e: SubmitEvent) {
		e.preventDefault();
		const text = body.trim();
		if (!text || sending) return;
		sending = true;
		if (await postComment(text)) body = '';
		sending = false;
	}

	async function removeComment(c: CommentView) {
		if (!confirm('Delete this comment?')) return;
		try {
			const res = await api<{ comments: CommentView[]; count: number }>(
				`/api/posts/${post.id}/comments/${c.id}`,
				{ method: 'DELETE' }
			);
			comments = res.comments;
			commentCount = res.count;
		} catch (e) {
			toastError(e);
		}
	}

	async function removePost() {
		if (!confirm('Delete this post for everyone? This cannot be undone.')) return;
		try {
			await api(`/api/posts/${post.id}`, { method: 'DELETE' });
			toast('Post deleted.');
			await goto('/', { invalidateAll: true });
		} catch (e) {
			toastError(e);
		}
	}

	async function toggleBan() {
		const next = !data.authorBanned;
		if (!confirm(next ? `Ban @${post.authorName} from posting, voting and commenting?` : `Lift the ban on @${post.authorName}?`)) return;
		try {
			await api(`/api/users/${post.authorId}/ban`, { body: { banned: next } });
			toast(next ? 'User banned.' : 'Ban lifted.');
			await invalidateAll();
		} catch (e) {
			toastError(e);
		}
	}
</script>

<svelte:head>
	<title>{post.caption ? `${post.caption.slice(0, 60)} · ` : ''}picslop</title>
</svelte:head>

<div class="mx-auto max-w-[1400px] px-4 py-3 md:px-6 md:py-10">
	<a href="/" onclick={back} class="label inline-flex min-h-8 items-center gap-1 text-muted hover:text-ink">← back to the board</a>

	<div class="mt-2 grid gap-6 md:mt-5 md:gap-8 lg:grid-cols-[minmax(0,1.6fr)_minmax(340px,1fr)]">
		<!-- Media -->
		<!-- Edge-to-edge on phones -->
		<figure
			class="box self-start overflow-hidden max-sm:-mx-4 max-sm:border-x-0 max-sm:shadow-none"
			style="animation: rise 380ms cubic-bezier(.2,.8,.2,1) both"
		>
			<div class="relative grid place-items-center {post.kind === 'video' ? 'bg-ink' : 'bg-paper-2'}">
				{#if post.kind === 'video'}
					<!-- svelte-ignore a11y_media_has_caption -->
					<video
						src={post.mediaUrl}
						poster={post.thumbUrl}
						controls
						playsinline
						preload="metadata"
						class="max-h-[80svh] w-full"
					></video>
				{:else}
					<!-- svelte-ignore a11y_no_noninteractive_element_interactions -->
					<img
						src={post.mediaUrl}
						alt={post.caption || `Upload by ${post.authorName}`}
						class="max-h-[80svh] w-auto max-w-full touch-manipulation object-contain select-none"
						width={post.width || undefined}
						height={post.height || undefined}
						draggable="false"
						ondblclick={like}
						onpointerup={onMediaPointerUp}
					/>
					{#key burst}
						{#if burst}
							<span class="like-burst pointer-events-none absolute inset-0 grid place-items-center" aria-hidden="true">
								<svg width="120" height="120" viewBox="0 0 12 12"><path d="M6 1.2 11 10H1Z" fill="var(--color-accent)" stroke="var(--color-ink)" stroke-width=".7" stroke-linejoin="round" /></svg>
							</span>
						{/if}
					{/key}
				{/if}
			</div>
		</figure>

		<!-- Sidebar -->
		<aside class="space-y-6">
			<div class="box relative p-5">
				<div class="tape -top-3 right-10 rotate-6" aria-hidden="true"></div>
				<div class="label flex flex-wrap items-center gap-x-3 gap-y-1 text-muted">
					<a href="/u/{post.authorId}" class="normal-case text-ink hover:underline">@{post.authorName}</a>
					<time datetime={new Date(post.createdAt).toISOString()}>{timeAgo(post.createdAt)}</time>
					{#if post.kind === 'video'}<span>video · {formatDuration(post.duration)}</span>{/if}
				</div>

				{#if post.caption}
					<p class="mt-3 text-xl leading-snug font-semibold break-words whitespace-pre-line">{post.caption}</p>
				{/if}

				<div class="mt-5 flex flex-wrap items-center gap-3">
					<VoteButtons bind:this={votes} postId={post.id} bind:up={post.up} bind:down={post.down} bind:myVote={post.myVote} size="lg" />
					<span class="label text-muted">{post.up} up · {post.down} down</span>
				</div>

				<div class="mt-5 flex flex-wrap gap-2" role="group" aria-label="Reactions">
					{#snippet reaction(emoji: string)}
						{@const on = post.myReactions.includes(emoji)}
						{@const count = post.reactions[emoji] ?? 0}
						<button
							class="flex items-center gap-1.5 border-2 px-2 py-1 transition-colors pointer-coarse:min-h-10 pointer-coarse:px-2.5 {on
								? 'border-ink bg-lime shadow-hard-sm'
								: count
									? 'border-ink bg-card hover:bg-paper-2'
									: 'border-line bg-transparent opacity-70 hover:border-ink hover:opacity-100'}"
							aria-pressed={on}
							aria-label="React {emoji}, {count}"
							onclick={() => react(emoji)}
						>
							<span
								class="text-lg leading-none"
								style={popped === emoji ? 'animation: pop 320ms ease' : ''}
								onanimationend={() => (popped = null)}>{emoji}</span
							>
							{#if count}<span class="font-mono text-sm font-semibold tabular-nums">{count}</span>{/if}
						</button>
					{/snippet}

					{#each quick as emoji (emoji)}
						{@render reaction(emoji)}
					{/each}
					{#each extraReactions as emoji (emoji)}
						{@render reaction(emoji)}
					{/each}
					<EmojiPicker onpick={pick} />
				</div>

				{#if data.canDelete || isAdmin}
					<div class="mt-6 flex flex-wrap gap-2 border-t-2 border-dashed border-line pt-4">
						{#if data.canDelete}
							<button class="btn btn-danger" onclick={removePost}>Delete post</button>
						{/if}
						{#if isAdmin && post.authorId !== me.id}
							<button class="btn" onclick={toggleBan}>{data.authorBanned ? 'Unban uploader' : 'Ban uploader'}</button>
						{/if}
					</div>
				{/if}
			</div>

			<!-- Comments -->
			<section id="comments" class="space-y-4">
				<h2 class="display text-3xl">
					Comments <span class="font-mono text-lg font-semibold text-muted">{commentCount}</span>
				</h2>

				<form class="space-y-2" onsubmit={comment}>
					<textarea
						class="field min-h-24 resize-y"
						placeholder="Add a comment"
						maxlength={COMMENT_MAX}
						bind:value={body}
						onkeydown={(e) => {
							if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
						}}
					></textarea>
					<div class="flex items-center justify-between">
						<span class="label text-muted">{body.length}/{COMMENT_MAX}</span>
						<button class="btn btn-ink" disabled={sending || !body.trim()}>{sending ? 'Posting…' : 'Comment'}</button>
					</div>
				</form>

				{#if comments.length === 0}
					<p class="text-muted">No comments yet. Say something nice (or at least funny).</p>
				{:else}
					<ol class="space-y-3">
						{#each thread.top as c (c.id)}
							<CommentThread
								comment={c}
								childrenOf={thread.childrenOf}
								postAuthorId={post.authorId}
								meId={me.id}
								{isAdmin}
								onreply={(parent, text) => postComment(text, parent.id)}
								ondelete={removeComment}
							/>
						{/each}
					</ol>
				{/if}
			</section>
		</aside>
	</div>
</div>

<style>
	.like-burst svg {
		animation: like-burst 650ms cubic-bezier(0.2, 0.9, 0.3, 1.3) forwards;
		filter: drop-shadow(4px 4px 0 var(--color-ink));
	}
	@keyframes like-burst {
		0% {
			opacity: 0;
			transform: scale(0.3) rotate(-12deg);
		}
		35% {
			opacity: 1;
			transform: scale(1.1) rotate(4deg);
		}
		70% {
			opacity: 1;
			transform: scale(1) rotate(0deg);
		}
		100% {
			opacity: 0;
			transform: scale(1.15) translateY(-20px);
		}
	}
</style>
