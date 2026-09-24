<script lang="ts">
	import { api } from '$lib/api';
	import Masonry from '$lib/components/Masonry.svelte';
	import { SORTS, type PostView } from '$lib/constants';
	import { FEED_COOKIE, setPrefCookie } from '$lib/masonry';
	import { toastError } from '$lib/toast.svelte';
	import { untrack } from 'svelte';

	let { data } = $props();

	// Deeply reactive local copy (votes mutate it); resets whenever the server sends a new first page.
	let posts = $derived.by(() => {
		const list = $state(structuredClone(data.posts));
		return list;
	});
	let nextOffset = $derived(data.nextOffset);
	let loading = $state(false);
	let sentinel = $state<HTMLDivElement>();

	// Phones can switch between a 2-up grid and a 1-up feed; remembered per device.
	// Read once: layout data isn't reloaded on client navigation, so deriving would undo the toggle.
	let feed = $state(untrack(() => data.boardFeed));
	function toggleLayout() {
		feed = !feed;
		setPrefCookie(FEED_COOKIE, feed ? '1' : '0');
	}

	async function loadMore() {
		if (loading || nextOffset === null) return;
		loading = true;
		try {
			const res = await api<{ posts: PostView[]; nextOffset: number | null }>(
				`/api/posts?sort=${data.sort}&offset=${nextOffset}`
			);
			const seen = new Set(posts.map((p) => p.id));
			posts.push(...res.posts.filter((p) => !seen.has(p.id)));
			nextOffset = res.nextOffset;
		} catch (e) {
			toastError(e);
		} finally {
			loading = false;
		}
	}

	$effect(() => {
		if (!sentinel) return;
		const io = new IntersectionObserver((entries) => entries[0]?.isIntersecting && loadMore(), {
			rootMargin: '800px'
		});
		io.observe(sentinel);
		return () => io.disconnect();
	});

	const blurb: Record<string, string> = {
		hot: 'Rising right now',
		top: 'All-time leaderboard',
		new: 'Fresh off the press',
		discussed: 'Where the comments are'
	};
</script>

<svelte:head><title>{SORTS.find((s) => s.id === data.sort)?.label} · picslop</title></svelte:head>

<div class="mx-auto max-w-[1400px] px-4 md:px-6">
	<section class="flex flex-col gap-4 pt-5 pb-4 md:flex-row md:items-end md:justify-between md:gap-5 md:pt-12 md:pb-6">
		<div>
			<p class="label text-muted">{blurb[data.sort]}</p>
			<h1 class="display mt-1.5 text-[2.6rem] md:mt-2 md:text-[5.5rem]">The board</h1>
		</div>

		<div class="flex items-center gap-2">
			<!-- Swipeable on phones, wraps on larger screens -->
			<nav
				class="-ml-4 flex min-w-0 flex-1 gap-2 overflow-x-auto pt-0.5 pr-2 pb-1.5 pl-4 [scrollbar-width:none] [mask-image:linear-gradient(to_right,#000_calc(100%-24px),transparent)] md:mx-0 md:flex-wrap md:overflow-visible md:px-0 md:[mask-image:none] [&::-webkit-scrollbar]:hidden"
				aria-label="Sort posts"
			>
				{#each SORTS as s (s.id)}
					<a
						href={s.id === 'hot' ? '/' : `/?sort=${s.id}`}
						data-sveltekit-noscroll
						aria-current={data.sort === s.id ? 'page' : undefined}
						class="btn shrink-0 whitespace-nowrap {data.sort === s.id ? 'btn-ink -rotate-1' : ''}"
					>
						{s.label}
					</a>
				{/each}
			</nav>
			<button
				class="btn shrink-0 px-2.5 sm:hidden"
				onclick={toggleLayout}
				aria-label={feed ? 'Show as grid' : 'Show as feed'}
				title={feed ? 'Grid' : 'Feed'}
			>
				{#if feed}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="3" y="3" width="7.5" height="7.5" /><rect x="13.5" y="3" width="7.5" height="7.5" /><rect x="3" y="13.5" width="7.5" height="7.5" /><rect x="13.5" y="13.5" width="7.5" height="7.5" /></svg>
				{:else}
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><rect x="4" y="3" width="16" height="11" /><path d="M4 18h16M4 21h10" /></svg>
				{/if}
			</button>
		</div>
	</section>

	<div class="mb-4 h-[3px] bg-ink md:mb-6"></div>

	{#if posts.length === 0}
		<div class="mx-auto my-16 max-w-md text-center">
			<p class="display text-4xl">Nothing here yet</p>
			<p class="mt-3 text-muted">Be the first to put something on the wall.</p>
			<a href="/upload" class="btn btn-accent mt-6">Upload something</a>
		</div>
	{:else}
		{#key data.sort}
			<Masonry {posts} {feed} ranked={data.sort === 'top'} />
		{/key}

		<div bind:this={sentinel} class="flex justify-center py-10">
			{#if nextOffset !== null}
				<button class="btn" onclick={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>
			{:else}
				<p class="label text-muted">— end of the board —</p>
			{/if}
		</div>
	{/if}
</div>
