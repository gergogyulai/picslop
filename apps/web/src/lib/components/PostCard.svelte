<script lang="ts">
	import type { PostView } from '$lib/constants';
	import { formatDuration, timeAgo } from '$lib/format';
	import { cardRatio } from '$lib/masonry';
	import VoteButtons from './VoteButtons.svelte';

	let { post, index = 0, rank }: { post: PostView; index?: number; rank?: number } = $props();

	// Deterministic small tilt per post so the board feels pinned-up, not gridded.
	const tilt = $derived(((post.id.charCodeAt(0) + post.id.charCodeAt(1)) % 5) * 0.45 - 0.9);
	const ratio = $derived(cardRatio(post));
	// Only the first screenful animates in; later cards (incl. infinite-scroll pages) just appear,
	// and `backwards` fill drops the animation once done so nothing stays promoted to a layer.
	const intro = $derived(
		index < 12 ? `animation: rise 420ms cubic-bezier(.2,.8,.2,1) ${index * 45}ms backwards;` : ''
	);
</script>

<article
	class="group relative mb-3 sm:mb-5"
	style="--tilt:{tilt}deg; transform: rotate({tilt}deg); {intro}"
>
	<div
		class="box @container transition-[transform,box-shadow] duration-150 group-hover:-translate-x-0.5 group-hover:-translate-y-0.5 group-hover:shadow-hard-lg"
	>
		<a href="/p/{post.id}" class="relative block overflow-hidden border-b-2 border-ink bg-paper-2" style="aspect-ratio: 1 / {ratio}">
			<img
				src={post.thumbUrl}
				alt={post.caption || `Upload by ${post.authorName}`}
				loading={index < 6 ? 'eager' : 'lazy'}
				decoding="async"
				class="absolute inset-0 h-full w-full object-cover"
			/>
			{#if post.kind === 'video'}
				<span class="label absolute bottom-2 left-2 flex items-center gap-1 border-2 border-ink bg-card px-1.5 py-0.5">
					<svg width="10" height="10" viewBox="0 0 10 10" aria-hidden="true"><path d="M2 1l7 4-7 4z" fill="currentColor" /></svg>
					{formatDuration(post.duration)}
				</span>
			{/if}
			{#if rank !== undefined && rank < 3}
				<span
					class="display absolute -right-1 -top-1 grid h-14 w-14 rotate-6 place-items-center border-2 border-ink text-2xl shadow-hard-sm {rank === 0 ? 'bg-lime' : 'bg-card'}"
					aria-label="Rank {rank + 1}"
				>
					#{rank + 1}
				</span>
			{/if}
		</a>

		<div class="space-y-2 p-2.5 @min-[220px]:p-3">
			{#if post.caption}
				<a href="/p/{post.id}" class="line-clamp-3 text-[0.95rem] font-medium leading-snug break-words hover:underline">{post.caption}</a>
			{/if}
			<div class="flex items-center justify-between gap-2">
				<VoteButtons postId={post.id} bind:up={post.up} bind:down={post.down} bind:myVote={post.myVote} />
				<a href="/p/{post.id}#comments" class="label hidden items-center gap-1 text-muted hover:text-ink @min-[220px]:flex" title="{post.comments} comments">
					<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>
					{post.comments}
				</a>
			</div>
			<div class="label flex justify-between gap-2 text-muted">
				<a href="/u/{post.authorId}" class="truncate normal-case hover:text-ink">@{post.authorName}</a>
				<span class="flex shrink-0 items-center gap-2">
					<!-- Narrow cards (2-up on phones) move the comment count down here -->
					<a href="/p/{post.id}#comments" class="flex items-center gap-0.5 @min-[220px]:hidden" aria-label="{post.comments} comments">
						<svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" /></svg>{post.comments}
					</a>
					<time datetime={new Date(post.createdAt).toISOString()}>{timeAgo(post.createdAt)}</time>
				</span>
			</div>
		</div>
	</div>
</article>
