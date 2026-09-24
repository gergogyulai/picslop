<script lang="ts">
	import { page } from '$app/state';
	import type { PostView } from '$lib/constants';
	import {
		COLS_COOKIE,
		currentBreakpointCols,
		distribute,
		estimateCardHeight,
		setPrefCookie,
		watchBreakpoints
	} from '$lib/masonry';
	import PostCard from './PostCard.svelte';

	let { posts, feed = false, ranked = false }: { posts: PostView[]; feed?: boolean; ranked?: boolean } = $props();

	// Server renders with the breakpoint remembered in a cookie, so the first paint usually matches.
	let bp = $state<number>(page.data.boardCols ?? 0);
	$effect(() => {
		const update = () => {
			bp = currentBreakpointCols();
			setPrefCookie(COLS_COOKIE, String(bp));
		};
		update();
		return watchBreakpoints(update);
	});

	const count = $derived(bp === 0 ? (feed ? 1 : 2) : bp);
	// Explicit columns instead of CSS `columns`: CSS rebalances every card whenever the list grows.
	const columns = $derived(distribute(posts, count));

	let width = $state(0);
	const gap = $derived(bp >= 3 ? 20 : bp === 2 ? 16 : 12);
	const colWidth = $derived(width ? (width - gap * (count - 1)) / count : 200);
</script>

<div class="flex items-start gap-3 sm:gap-4 md:gap-5" bind:clientWidth={width}>
	{#each columns as col, c (c)}
		<div class="flex min-w-0 flex-1 flex-col">
			{#each col as { post, index } (post.id)}
				<!-- Offscreen cards skip layout/paint; the size hint keeps the scrollbar steady until measured. -->
				<div class="offscreen-skip" style="contain-intrinsic-size: auto {Math.round(colWidth)}px auto {Math.round(estimateCardHeight(post, colWidth))}px">
					<PostCard {post} {index} rank={ranked ? index : undefined} />
				</div>
			{/each}
		</div>
	{/each}
</div>
