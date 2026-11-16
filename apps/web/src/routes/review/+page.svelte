<script lang="ts">
	import { timeAgo } from '$lib/format';

	let { data } = $props();
	const waiting = $derived(data.sets.reduce((n, s) => n + s.pending, 0));
</script>

<svelte:head><title>Review · picslop</title></svelte:head>

<div class="mx-auto max-w-[1100px] px-4 md:px-6">
	<section class="pt-5 pb-4 md:pt-12 md:pb-6">
		<p class="label text-muted">reviewer</p>
		<h1 class="display mt-1.5 text-[2.6rem] md:mt-2 md:text-[5.5rem]">Review</h1>
		<p class="mt-3 max-w-prose text-sm text-muted">
			Approve or veto each image in the curated sets. Only approved images make it into a video. {waiting
				? `${waiting} ${waiting === 1 ? 'image is' : 'images are'} waiting.`
				: 'Nothing is waiting right now.'}
		</p>
	</section>

	<div class="mb-5 h-[3px] bg-ink md:mb-8"></div>

	<ul class="flex flex-col gap-3">
		{#each data.sets as s (s.id)}
			<li>
				<a href="/review/{s.id}" class="box flex flex-wrap items-center gap-x-4 gap-y-2 p-4 transition-transform hover:-translate-y-0.5">
					<div class="min-w-0 flex-1">
						<h2 class="display text-2xl break-words">{s.name}</h2>
						<p class="mt-1 font-mono text-xs text-muted">{s.count} images · by @{s.createdByName || 'someone'} · updated {timeAgo(s.updatedAt)}</p>
					</div>
					<div class="flex flex-wrap gap-1.5">
						{#if s.pending}<span class="label border-2 border-ink bg-accent px-1.5 py-0.5">{s.pending} to review</span>{/if}
						<span class="label border-2 border-ink bg-lime px-1.5 py-0.5">{s.approved} approved</span>
						{#if s.vetoed}<span class="label border-2 border-danger bg-danger px-1.5 py-0.5 text-paper">{s.vetoed} vetoed</span>{/if}
					</div>
				</a>
			</li>
		{:else}
			<li class="py-10 text-center text-muted">No curated sets yet.</li>
		{/each}
	</ul>
</div>
