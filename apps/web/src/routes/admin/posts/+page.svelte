<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import { timeAgo } from '$lib/format';
	import type { AdminPost } from '$lib/server/admin';
	import { toast, toastError } from '$lib/toast.svelte';

	let { data } = $props();

	const FILTERS = [
		{ id: 'all', label: 'All' },
		{ id: 'image', label: 'Images' },
		{ id: 'video', label: 'Videos' },
		{ id: 'picked', label: 'Picked' },
		{ id: 'negative', label: 'Negative score' }
	] as const;
	const SORTS = [
		{ id: 'new', label: 'Newest' },
		{ id: 'old', label: 'Oldest' },
		{ id: 'top', label: 'Top score' },
		{ id: 'low', label: 'Lowest score' }
	] as const;
	/** Tiles rendered per "show more" step. */
	const STEP = 120;
	/** Ids per request; matches the API's cap. */
	const BATCH = 500;

	let q = $state('');
	let filter = $state<(typeof FILTERS)[number]['id']>('all');
	let sort = $state<(typeof SORTS)[number]['id']>('new');
	let limit = $state(STEP);
	let selected = $state(new Set<string>());
	let anchor = $state<string | null>(null);

	const match: Record<typeof filter, (p: AdminPost) => boolean> = {
		all: () => true,
		image: (p) => p.kind === 'image',
		video: (p) => p.kind === 'video',
		picked: (p) => p.picked,
		negative: (p) => p.score < 0
	};
	const by: Record<typeof sort, (a: AdminPost, b: AdminPost) => number> = {
		new: (a, b) => b.createdAt - a.createdAt,
		old: (a, b) => a.createdAt - b.createdAt,
		top: (a, b) => b.score - a.score || b.createdAt - a.createdAt,
		low: (a, b) => a.score - b.score || b.createdAt - a.createdAt
	};

	const counts = $derived(Object.fromEntries(FILTERS.map((f) => [f.id, data.posts.filter(match[f.id]).length])));
	const shown = $derived.by(() => {
		const needle = q.trim().toLowerCase().replace(/^@/, '');
		return data.posts
			.filter(match[filter])
			.filter((p) => !needle || p.caption.toLowerCase().includes(needle) || p.authorName.toLowerCase().includes(needle) || p.id === needle)
			.sort(by[sort]);
	});
	const visible = $derived(shown.slice(0, limit));

	// Drop selections for posts that no longer exist (after a delete + reload).
	$effect(() => {
		const ids = new Set(data.posts.map((p) => p.id));
		if ([...selected].some((id) => !ids.has(id))) selected = new Set([...selected].filter((id) => ids.has(id)));
	});

	const allShownSelected = $derived(shown.length > 0 && shown.every((p) => selected.has(p.id)));
	const selectedPicked = $derived(data.posts.filter((p) => p.picked && selected.has(p.id)).length);

	function toggle(p: AdminPost, e: MouseEvent | KeyboardEvent) {
		const next = new Set(selected);
		const on = !next.has(p.id);
		// Shift-click selects (or clears) the whole range from the last tile touched.
		if (e.shiftKey && anchor) {
			const a = visible.findIndex((x) => x.id === anchor);
			const b = visible.findIndex((x) => x.id === p.id);
			if (a >= 0 && b >= 0) {
				for (const x of visible.slice(Math.min(a, b), Math.max(a, b) + 1)) on ? next.add(x.id) : next.delete(x.id);
				selected = next;
				anchor = p.id;
				return;
			}
		}
		on ? next.add(p.id) : next.delete(p.id);
		selected = next;
		anchor = p.id;
	}

	function toggleAllShown() {
		const next = new Set(selected);
		if (allShownSelected) for (const p of shown) next.delete(p.id);
		else for (const p of shown) next.add(p.id);
		selected = next;
	}

	// --- Delete -----------------------------------------------------------------------------

	let dialog = $state<HTMLDialogElement>();
	let deleting = $state(false);
	let progress = $state(0);

	async function doDelete(e: SubmitEvent) {
		e.preventDefault();
		const ids = [...selected];
		if (!ids.length) return;
		deleting = true;
		progress = 0;
		let deleted = 0;
		try {
			for (let i = 0; i < ids.length; i += BATCH) {
				const r = await api<{ deleted: number; missing: number }>('/api/admin/posts', {
					method: 'DELETE',
					body: { ids: ids.slice(i, i + BATCH) }
				});
				deleted += r.deleted;
				progress = Math.min(ids.length, i + BATCH);
			}
			dialog?.close();
			toast(`Deleted ${deleted} ${deleted === 1 ? 'post' : 'posts'}.`);
			selected = new Set();
		} catch (err) {
			toastError(err);
		} finally {
			deleting = false;
			// Refresh even on a partial failure so the grid matches what's left.
			await invalidateAll();
		}
	}
</script>

<svelte:head><title>Posts · Admin · picslop</title></svelte:head>

<div class="flex flex-col gap-3 md:flex-row md:items-center">
	<input class="field md:max-w-xs" type="search" placeholder="Search caption or @author" bind:value={q} oninput={() => (limit = STEP)} aria-label="Search posts" />
	<div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
		{#each FILTERS as f (f.id)}
			<button
				class="btn shrink-0 px-3 py-1.5 text-xs whitespace-nowrap {filter === f.id ? 'btn-ink' : ''}"
				onclick={() => ((filter = f.id), (limit = STEP))}
				aria-pressed={filter === f.id}
			>
				{f.label} <span class="font-mono opacity-70">{counts[f.id]}</span>
			</button>
		{/each}
	</div>
	<label class="label flex items-center gap-2 text-muted md:ml-auto">
		sort
		<select class="border-2 border-ink bg-card px-2 py-1.5 font-mono text-xs text-ink normal-case" bind:value={sort}>
			{#each SORTS as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
		</select>
	</label>
</div>

<!-- Selection bar: sticks to the top while scrolling the grid -->
<div class="sticky top-0 z-10 -mx-4 mt-4 mb-3 flex flex-wrap items-center gap-2 border-b-2 border-ink bg-paper px-4 py-2.5 md:mx-0 md:px-0">
	<label class="flex items-center gap-2 text-sm">
		<input type="checkbox" class="h-4 w-4 accent-[var(--color-ink)]" checked={allShownSelected} onchange={toggleAllShown} disabled={!shown.length} />
		Select all {shown.length} shown
	</label>
	<p class="label ml-1 text-muted">
		{selected.size ? `${selected.size} selected` : `${shown.length} of ${data.posts.length} posts`}
	</p>
	<div class="ml-auto flex gap-2">
		{#if selected.size}
			<button class="btn px-3 py-1.5 text-xs" onclick={() => (selected = new Set())} disabled={deleting}>Clear</button>
		{/if}
		<button class="btn btn-danger px-3 py-1.5 text-xs" onclick={() => dialog?.showModal()} disabled={!selected.size || deleting}>
			Delete {selected.size || ''}…
		</button>
	</div>
</div>
<p class="mb-3 hidden text-xs text-muted md:block">Tip: shift-click to select a range.</p>

{#if shown.length === 0}
	<p class="py-10 text-center text-muted">No posts match.</p>
{:else}
	<ul class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6 md:gap-3 xl:grid-cols-8">
		{#each visible as p (p.id)}
			{@const on = selected.has(p.id)}
			<li class="min-w-0">
				<button
					type="button"
					class="group relative block aspect-square w-full overflow-hidden border-2 bg-paper-2 {on ? 'border-danger ring-2 ring-danger' : 'border-ink'}"
					onclick={(e) => toggle(p, e)}
					aria-pressed={on}
					aria-label="{on ? 'Deselect' : 'Select'} post by @{p.authorName}{p.caption ? `: ${p.caption}` : ''}"
				>
					<img src={p.thumbUrl} alt="" class="h-full w-full object-cover {on ? 'opacity-60' : ''}" loading="lazy" />
					<span class="absolute top-1 left-1 grid h-5 w-5 place-items-center border-2 border-ink text-xs {on ? 'bg-danger text-paper' : 'bg-card'}">{on ? '✓' : ''}</span>
					<span class="absolute top-0 right-0 flex gap-px">
						{#if p.kind === 'video'}<span class="label bg-ink px-1 py-0.5 text-paper">vid</span>{/if}
						{#if p.picked}<span class="label bg-lime px-1 py-0.5">★</span>{/if}
					</span>
				</button>
				<div class="mt-1 flex items-baseline justify-between gap-1 font-mono text-xs">
					<a href="/u/{p.authorId}" class="min-w-0 truncate hover:underline">@{p.authorName}</a>
					<a href="/p/{p.id}" class="shrink-0 text-muted hover:underline" title="Open post">{p.score} pts ↗</a>
				</div>
				<p class="truncate text-xs text-muted" title={p.caption}>{timeAgo(p.createdAt)}{p.caption ? ` · ${p.caption}` : ''}</p>
			</li>
		{/each}
	</ul>
	{#if shown.length > limit}
		<div class="mt-5 flex justify-center">
			<button class="btn" onclick={() => (limit += STEP)}>Show more ({shown.length - limit} left)</button>
		</div>
	{/if}
{/if}

<dialog
	bind:this={dialog}
	class="box m-auto w-[min(30rem,calc(100vw-2rem))] p-0 backdrop:bg-ink/50"
	oncancel={(e) => deleting && e.preventDefault()}
>
	<form class="p-5" onsubmit={doDelete}>
		<p class="label text-danger">permanent</p>
		<h2 class="display mt-1.5 text-2xl">Delete {selected.size} {selected.size === 1 ? 'post' : 'posts'}</h2>
		<p class="mt-4 text-sm">
			This removes the files, comments, votes and reactions on {selected.size === 1 ? 'it' : 'them'}, with no undo.
			{#if selectedPicked}<b>{selectedPicked} of them {selectedPicked === 1 ? 'is' : 'are'} picked.</b>{/if}
		</p>
		<div class="mt-5 flex justify-end gap-2">
			<button type="button" class="btn" onclick={() => dialog?.close()} disabled={deleting}>Cancel</button>
			<button class="btn btn-danger" disabled={deleting || !selected.size}>
				{deleting ? (selected.size > BATCH ? `Deleting… ${progress}/${selected.size}` : 'Deleting…') : 'Delete forever'}
			</button>
		</div>
	</form>
</dialog>
