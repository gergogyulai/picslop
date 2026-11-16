<script lang="ts">
	import { goto } from '$app/navigation';
	import { api } from '$lib/api';
	import { timeAgo } from '$lib/format';
	import { SET_NAME_MAX, blockerText, canExport } from '$lib/sets';
	import { toastError } from '$lib/toast.svelte';

	let { data } = $props();

	let name = $state('');
	let creating = $state(false);

	async function create(e: SubmitEvent) {
		e.preventDefault();
		creating = true;
		try {
			const { id } = await api<{ id: string }>('/api/sets', { body: { name } });
			await goto(`/curate/${id}`);
		} catch (err) {
			toastError(err);
		} finally {
			creating = false;
		}
	}
</script>

<svelte:head><title>Curated sets · picslop</title></svelte:head>

<div class="mx-auto max-w-[1400px] px-4 md:px-6">
	<section class="pt-5 pb-4 md:pt-12 md:pb-6">
		<p class="label text-muted">curator dashboard</p>
		<h1 class="display mt-1.5 text-[2.6rem] md:mt-2 md:text-[5.5rem]">Curated sets</h1>
		<p class="mt-3 max-w-prose text-sm text-muted">
			Each set becomes a slideshow video. Add board images, arrange them in video order, and export once a reviewer has approved
			every one.
		</p>
	</section>

	<div class="mb-5 h-[3px] bg-ink md:mb-8"></div>

	<form class="box flex flex-col gap-2 p-4 md:flex-row md:items-center" onsubmit={create}>
		<input class="field md:max-w-md" type="text" maxlength={SET_NAME_MAX} required placeholder="New set name, e.g. Spring recap" bind:value={name} aria-label="New set name" />
		<button class="btn btn-ink shrink-0" disabled={creating || !name.trim()}>{creating ? 'Creating…' : '+ New set'}</button>
	</form>

	<ul class="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
		{#each data.sets as s (s.id)}
			{@const clean = canExport(s.blockers)}
			<li>
				<a href="/curate/{s.id}" class="box block p-4 transition-transform hover:-translate-y-0.5 {s.blockers.vetoed ? 'border-danger' : ''}">
					<div class="flex items-start justify-between gap-3">
						<h2 class="display min-w-0 text-2xl break-words">{s.name}</h2>
						{#if clean}
							<span class="label shrink-0 border-2 border-ink bg-lime px-1.5 py-0.5">ready</span>
						{:else if s.blockers.vetoed}
							<span class="label shrink-0 border-2 border-danger bg-danger px-1.5 py-0.5 text-paper">⚠ {s.blockers.vetoed} vetoed</span>
						{/if}
					</div>
					<div class="mt-3 flex h-16 gap-1.5 overflow-hidden">
						{#each s.thumbs as t (t.id)}
							<div class="relative h-16 w-16 shrink-0 border-2 border-ink bg-paper-2">
								{#if t.url}<img src={t.url} alt="" class="h-full w-full object-cover {t.state === 'vetoed' ? 'opacity-40 grayscale' : ''}" loading="lazy" />{/if}
							</div>
						{:else}
							<p class="self-center text-sm text-muted">No images yet.</p>
						{/each}
					</div>
					<p class="mt-3 font-mono text-xs text-muted">
						<b class="text-ink">{s.approved}</b>/{s.count} approved · {s.createdByName ? `by @${s.createdByName} · ` : ''}updated {timeAgo(s.updatedAt)}
					</p>
					{#if !clean && !s.blockers.empty}
						<p class="mt-1 text-xs text-muted">{blockerText(s.blockers)}</p>
					{/if}
				</a>
			</li>
		{:else}
			<li class="py-10 text-center text-muted md:col-span-2 xl:col-span-3">No curated sets yet. Start one above.</li>
		{/each}
	</ul>
</div>
