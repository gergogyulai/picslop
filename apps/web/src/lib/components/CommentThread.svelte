<script lang="ts">
	import { COMMENT_MAX, COMMENT_MAX_DEPTH, type CommentView } from '$lib/constants';
	import { timeAgo } from '$lib/format';
	import CommentThread from './CommentThread.svelte';

	type Props = {
		comment: CommentView;
		childrenOf: Map<string, CommentView[]>;
		postAuthorId: string;
		meId: string;
		isAdmin: boolean;
		onreply: (parent: CommentView, text: string) => Promise<boolean>;
		ondelete: (c: CommentView) => void;
	};
	let { comment: c, childrenOf, postAuthorId, meId, isAdmin, onreply, ondelete }: Props = $props();

	const replies = $derived(childrenOf.get(c.id) ?? []);
	let collapsed = $state(false);
	let replying = $state(false);
	let text = $state('');
	let sending = $state(false);
	let input = $state<HTMLTextAreaElement>();

	/** Every descendant, so a collapsed thread can say how much it hides. */
	function countAll(id: string): number {
		return (childrenOf.get(id) ?? []).reduce((n, r) => n + 1 + countAll(r.id), 0);
	}

	function openReply() {
		replying = true;
		// At max depth the reply lands next to this comment, so make clear who it answers.
		if (!text && c.depth >= COMMENT_MAX_DEPTH) text = `@${c.authorName} `;
		requestAnimationFrame(() => {
			input?.focus();
			input?.setSelectionRange(text.length, text.length);
		});
	}

	async function send(e: SubmitEvent) {
		e.preventDefault();
		const body = text.trim();
		if (!body || sending) return;
		sending = true;
		if (await onreply(c, body)) {
			text = '';
			replying = false;
			collapsed = false;
		}
		sending = false;
	}
</script>

<li id="c-{c.id}" class="scroll-mt-24">
	<div
		class="border-2 p-3 {c.deleted
			? 'border-dashed border-line bg-transparent'
			: `border-ink bg-card ${c.authorId === postAuthorId ? 'border-l-8 border-l-accent' : ''}`}"
	>
		<div class="label flex flex-wrap items-center gap-x-2 gap-y-1 text-muted">
			{#if replies.length}
				<button
					class="-ml-1 grid h-5 w-5 place-items-center border pointer-coarse:h-7 pointer-coarse:w-7 border-current font-mono leading-none hover:bg-paper-2 hover:text-ink"
					aria-expanded={!collapsed}
					aria-label={collapsed ? 'Expand replies' : 'Collapse replies'}
					onclick={() => (collapsed = !collapsed)}
				>
					{collapsed ? '+' : '−'}
				</button>
			{/if}
			{#if c.deleted}
				<span class="italic normal-case">[deleted]</span>
			{:else}
				<a href="/u/{c.authorId}" class="normal-case text-ink hover:underline">@{c.authorName}</a>
				{#if c.authorId === postAuthorId}<span class="bg-accent px-1 text-ink">op</span>{/if}
			{/if}
			<time datetime={new Date(c.createdAt).toISOString()}>{timeAgo(c.createdAt)}</time>
			{#if collapsed}
				<span class="text-ink">· {countAll(c.id)} hidden</span>
			{/if}
		</div>

		{#if !c.deleted}
			<p class="mt-1.5 break-words whitespace-pre-line">{c.body}</p>
			<div class="label mt-2 flex gap-4 text-muted pointer-coarse:mt-1 pointer-coarse:gap-2 [&>button]:pointer-coarse:min-h-9 [&>button]:pointer-coarse:px-2 [&>button]:pointer-coarse:first:-ml-2">
				<button class="hover:text-ink" onclick={() => (replying ? (replying = false) : openReply())} aria-expanded={replying}>
					{replying ? 'cancel' : 'reply'}
				</button>
				{#if c.authorId === meId || isAdmin}
					<button class="hover:text-danger" onclick={() => ondelete(c)} aria-label="Delete comment">delete</button>
				{/if}
			</div>
		{:else}
			<p class="mt-1 text-sm text-muted italic">This comment was deleted.</p>
		{/if}
	</div>

	{#if replying}
		<form class="mt-2 ml-1.5 space-y-2 border-l-2 border-ink pl-2.5 md:ml-5 md:pl-3" onsubmit={send}>
			<textarea
				bind:this={input}
				class="field min-h-20 resize-y sm:text-[0.95rem]"
				placeholder="Reply to @{c.authorName}"
				maxlength={COMMENT_MAX}
				bind:value={text}
				onkeydown={(e) => {
					if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) e.currentTarget.form?.requestSubmit();
					if (e.key === 'Escape') replying = false;
				}}
			></textarea>
			<div class="flex items-center justify-between">
				<span class="label text-muted">{text.length}/{COMMENT_MAX}</span>
				<button class="btn btn-ink px-3 py-1.5" disabled={sending || !text.trim()}>{sending ? 'Posting…' : 'Reply'}</button>
			</div>
		</form>
	{/if}

	{#if replies.length && !collapsed}
		<ol class="mt-3 ml-1 space-y-3 border-l-2 border-line pl-2.5 sm:ml-2 sm:pl-3 md:ml-4 md:pl-4">
			{#each replies as r (r.id)}
				<CommentThread comment={r} {childrenOf} {postAuthorId} {meId} {isAdmin} {onreply} {ondelete} />
			{/each}
		</ol>
	{/if}
</li>
