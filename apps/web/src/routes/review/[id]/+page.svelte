<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import PhotoViewer from '$lib/components/PhotoViewer.svelte';
	import StateBadge from '$lib/components/StateBadge.svelte';
	import { timeAgo } from '$lib/format';
	import { VETO_REASON_MAX, type ItemState, type SetItemView } from '$lib/sets';
	import { toast, toastError } from '$lib/toast.svelte';
	import { SvelteSet } from 'svelte/reactivity';

	let { data } = $props();
	const set = $derived(data.set);

	const FILTERS = [
		{ id: 'pending', label: 'To review' },
		{ id: 'all', label: 'All' },
		{ id: 'approved', label: 'Approved' },
		{ id: 'vetoed', label: 'Vetoed' }
	] as const;
	let filter = $state<(typeof FILTERS)[number]['id']>('pending');

	const live = $derived(set.items.filter((i) => i.post));
	const counts = $derived(
		Object.fromEntries(FILTERS.map((f) => [f.id, f.id === 'all' ? live.length : live.filter((i) => i.state === f.id).length]))
	);
	const shown = $derived(filter === 'all' ? live : live.filter((i) => i.state === filter));

	let busy = $state<string | null>(null);
	let vetoing = $state<string | null>(null);
	let reason = $state('');

	async function judge(it: SetItemView, state: Exclude<ItemState, 'pending'>, why = '') {
		busy = it.postId;
		try {
			await api(`/api/sets/${set.id}/items/${it.postId}/review`, { body: { state, reason: why } });
			vetoing = null;
			reason = '';
			selected.delete(it.postId);
			await invalidateAll();
		} catch (e) {
			toastError(e);
			await invalidateAll();
		} finally {
			busy = null;
		}
	}

	function startVeto(it: SetItemView) {
		vetoing = it.postId;
		reason = '';
	}

	// --- Bulk selection -----------------------------------------------------------------------

	const selected = new SvelteSet<string>();
	let lastClicked: string | null = null;
	// Only what's on screen counts, so switching filters never acts on hidden images.
	const picked = $derived(shown.filter((i) => selected.has(i.postId)));
	const allPicked = $derived(shown.length > 0 && picked.length === shown.length);

	function setFilter(id: typeof filter) {
		filter = id;
		selected.clear();
		lastClicked = null;
	}

	function toggle(it: SetItemView, e: MouseEvent) {
		const on = !selected.has(it.postId);
		const from = lastClicked ? shown.findIndex((i) => i.postId === lastClicked) : -1;
		if (e.shiftKey && from !== -1) {
			// Shift-click selects (or clears) the whole range since the last click.
			const to = shown.indexOf(it);
			for (const i of shown.slice(Math.min(from, to), Math.max(from, to) + 1)) on ? selected.add(i.postId) : selected.delete(i.postId);
		} else if (on) selected.add(it.postId);
		else selected.delete(it.postId);
		lastClicked = it.postId;
	}

	function toggleAll() {
		if (allPicked) selected.clear();
		else for (const i of shown) selected.add(i.postId);
	}

	let bulkBusy = $state(false);
	let bulkVetoing = $state(false);
	let bulkReason = $state('');

	async function judgeMany(state: Exclude<ItemState, 'pending'>, why = '') {
		const ids = picked.filter((i) => i.state !== state).map((i) => i.postId);
		if (!ids.length) {
			toast(`Everything selected is already ${state}.`);
			return;
		}
		bulkBusy = true;
		try {
			const r = await api<{ reviewed: number }>(`/api/sets/${set.id}/review`, { body: { postIds: ids, state, reason: why } });
			const gone = ids.length - r.reviewed;
			toast(`${state === 'approved' ? 'Approved' : 'Vetoed'} ${r.reviewed} ${r.reviewed === 1 ? 'image' : 'images'}${gone ? ` (${gone} no longer in the set)` : ''}.`);
			selected.clear();
			bulkVetoing = false;
			bulkReason = '';
			await invalidateAll();
		} catch (e) {
			toastError(e);
			await invalidateAll();
		} finally {
			bulkBusy = false;
		}
	}

	// --- Photo viewer -------------------------------------------------------------------------

	const photos = $derived(
		shown.map((it) => ({ id: it.postId, src: it.post!.mediaUrl, thumb: it.post!.thumbUrl, alt: it.post!.caption || `Image ${it.position}`, it }))
	);
	let viewing = $state<number | null>(null);

	function openViewer(it: SetItemView) {
		vetoing = null;
		viewing = shown.indexOf(it);
	}

	// Shortcuts while the viewer is open: A approves, V starts a veto.
	function viewerKey(e: KeyboardEvent) {
		if (viewing === null || e.metaKey || e.ctrlKey || e.altKey) return;
		if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
		const it = photos[viewing]?.it;
		if (!it || busy) return;
		if (e.key === 'a' && it.state !== 'approved') {
			e.preventDefault();
			judge(it, 'approved');
		} else if (e.key === 'v' && it.state !== 'vetoed') {
			e.preventDefault();
			startVeto(it);
		}
	}
</script>

<svelte:head><title>Review {set.name} · picslop</title></svelte:head>

<svelte:window onkeydown={viewerKey} />

{#snippet verdict(it: SetItemView)}
	{#if vetoing === it.postId}
		<form
			class="flex flex-col gap-2"
			onsubmit={(e) => {
				e.preventDefault();
				judge(it, 'vetoed', reason);
			}}
		>
			<!-- svelte-ignore a11y_autofocus -->
			<input class="field py-2 text-sm" maxlength={VETO_REASON_MAX} placeholder="Reason (optional)" bind:value={reason} aria-label="Veto reason (optional)" autofocus />
			<div class="flex gap-2">
				<button class="btn btn-danger flex-1 px-2 py-1.5 text-xs" disabled={busy === it.postId}>Veto</button>
				<button class="btn px-2 py-1.5 text-xs" type="button" onclick={() => (vetoing = null)}>Cancel</button>
			</div>
		</form>
	{:else}
		<div class="flex gap-2">
			<button class="btn flex-1 px-2 py-1.5 text-xs {it.state === 'approved' ? '' : 'bg-lime!'}" onclick={() => judge(it, 'approved')} disabled={busy === it.postId || it.state === 'approved'}>
				✓ Approve
			</button>
			<button class="btn btn-danger flex-1 px-2 py-1.5 text-xs" onclick={() => startVeto(it)} disabled={busy === it.postId || it.state === 'vetoed'}>
				✕ Veto…
			</button>
		</div>
	{/if}
{/snippet}

{#snippet details(it: SetItemView)}
	{@const p = it.post!}
	{#if p.caption}<p class="line-clamp-2 text-sm">{p.caption}</p>{/if}
	<p class="font-mono text-xs text-muted">
		by @{p.authorName || 'someone'} · added by @{it.addedByName || 'someone'}
	</p>
	{#if it.state !== 'pending'}
		<p class="font-mono text-xs text-muted">{it.state} by @{it.stateByName || 'someone'} · {timeAgo(it.stateAt)}</p>
	{/if}
	{#if it.state === 'vetoed' && it.reason}<p class="text-sm text-danger">“{it.reason}”</p>{/if}
{/snippet}

<div class="mx-auto max-w-[1400px] px-4 md:px-6 {selected.size ? 'pb-28' : ''}">
	<section class="pt-5 pb-4 md:pt-10 md:pb-6">
		<a href="/review" class="label text-muted hover:underline">‹ all sets</a>
		<h1 class="display mt-1.5 text-[2.3rem] break-words md:mt-2 md:text-[4.2rem]">{set.name}</h1>
		<p class="mt-2 max-w-prose text-sm text-muted">
			You're judging the images, not their order: curators can rearrange the set without sending anything back to you.
		</p>
	</section>

	<div class="mb-5 h-[3px] bg-ink"></div>

	<div class="mb-4 flex flex-wrap items-center gap-2">
		<div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
			{#each FILTERS as f (f.id)}
				<button class="btn shrink-0 px-3 py-1.5 text-xs whitespace-nowrap {filter === f.id ? 'btn-ink' : ''}" onclick={() => setFilter(f.id)} aria-pressed={filter === f.id}>
					{f.label} <span class="font-mono opacity-70">{counts[f.id]}</span>
				</button>
			{/each}
		</div>
		{#if shown.length}
			<label class="label ml-auto flex cursor-pointer items-center gap-2 pb-1 text-muted">
				<input type="checkbox" class="size-4 accent-ink" checked={allPicked} {@attach (el) => { el.indeterminate = picked.length > 0 && !allPicked; }} onchange={toggleAll} />
				select all
			</label>
		{/if}
	</div>

	<ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each shown as it (it.postId)}
			{@const p = it.post!}
			{@const on = selected.has(it.postId)}
			<li
				class="box relative flex flex-col {it.state === 'vetoed' ? 'border-danger' : ''} {on ? 'outline-4 outline-offset-2 outline-accent' : ''} {busy === it.postId ||
				(bulkBusy && on)
					? 'opacity-50'
					: ''}"
			>
				<button class="block cursor-zoom-in border-b-2 border-ink bg-paper-2" onclick={() => openViewer(it)} title="View larger">
					<img src={p.thumbUrl} alt={p.caption || `Image ${it.position}`} class="aspect-square w-full object-cover" loading="lazy" />
				</button>
				<label
					class="absolute top-2 left-2 flex size-8 cursor-pointer items-center justify-center border-2 border-ink {on ? 'bg-accent' : 'bg-card/90'}"
					title="Select (shift-click for a range)"
				>
					<input
						type="checkbox"
						class="size-4 accent-ink"
						checked={on}
						onclick={(e) => toggle(it, e)}
						aria-label="Select image #{it.position}"
					/>
				</label>
				<div class="flex flex-1 flex-col gap-1.5 p-3">
					<div class="flex items-center justify-between gap-2">
						<StateBadge state={it.state} />
						<span class="label text-muted">#{it.position}</span>
					</div>
					{@render details(it)}
					<div class="mt-auto pt-2">
						{#if viewing === null}{@render verdict(it)}{/if}
					</div>
				</div>
			</li>
		{:else}
			<li class="py-10 text-center text-muted sm:col-span-2 lg:col-span-3 xl:col-span-4">
				{filter === 'pending' ? 'Nothing waiting for review in this set.' : 'No images here.'}
			</li>
		{/each}
	</ul>
</div>

{#if picked.length}
	<div class="fixed inset-x-0 bottom-0 z-30 border-t-2 border-ink bg-card px-4 py-3 shadow-[0_-4px_0_0_var(--color-ink)] md:px-6" role="region" aria-label="Bulk review">
		<div class="mx-auto flex max-w-[1400px] flex-wrap items-center gap-2">
			<span class="label mr-auto">{picked.length} selected</span>
			{#if bulkVetoing}
				<form
					class="flex w-full flex-wrap gap-2 md:w-auto"
					onsubmit={(e) => {
						e.preventDefault();
						judgeMany('vetoed', bulkReason);
					}}
				>
					<!-- svelte-ignore a11y_autofocus -->
					<input class="field min-w-0 flex-1 py-1.5 text-sm md:w-72" maxlength={VETO_REASON_MAX} placeholder="Reason for all (optional)" bind:value={bulkReason} aria-label="Veto reason (optional)" autofocus />
					<button class="btn btn-danger px-3 py-1.5 text-xs" disabled={bulkBusy}>{bulkBusy ? 'Vetoing…' : `Veto ${picked.length}`}</button>
					<button class="btn px-3 py-1.5 text-xs" type="button" onclick={() => (bulkVetoing = false)}>Cancel</button>
				</form>
			{:else}
				<button class="btn bg-lime! px-3 py-1.5 text-xs" onclick={() => judgeMany('approved')} disabled={bulkBusy}>{bulkBusy ? 'Approving…' : `✓ Approve ${picked.length}`}</button>
				<button class="btn btn-danger px-3 py-1.5 text-xs" onclick={() => ((bulkVetoing = true), (bulkReason = ''))} disabled={bulkBusy}>✕ Veto {picked.length}…</button>
				<button class="btn px-3 py-1.5 text-xs" onclick={() => selected.clear()} disabled={bulkBusy}>Clear</button>
			{/if}
		</div>
	</div>
{/if}

<PhotoViewer {photos} bind:index={viewing}>
	{#snippet info(p)}
		<div class="flex items-center justify-between gap-2">
			<StateBadge state={p.it.state} />
			<span class="label text-muted">#{p.it.position} in the video</span>
		</div>
		{@render details(p.it)}
		{#if p.it.post?.width}<p class="font-mono text-xs text-muted">{p.it.post.width}×{p.it.post.height}</p>{/if}
	{/snippet}
	{#snippet actions(p)}
		<div class={busy === p.it.postId ? 'opacity-50' : ''}>{@render verdict(p.it)}</div>
		<p class="mt-2 hidden font-mono text-[0.65rem] text-muted md:block">a approve · v veto</p>
	{/snippet}
</PhotoViewer>
