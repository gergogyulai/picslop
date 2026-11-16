<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import { flip } from 'svelte/animate';
	import { api } from '$lib/api';
	import PhotoViewer from '$lib/components/PhotoViewer.svelte';
	import StateBadge from '$lib/components/StateBadge.svelte';
	import type { PostView } from '$lib/constants';
	import { timeAgo } from '$lib/format';
	import { SET_MAX_ITEMS, SET_NAME_MAX, blockerText, type BulkAddResult, canExport, exportBlockers, type SetItemView, type SetLogEntry } from '$lib/sets';
	import { toast, toastError } from '$lib/toast.svelte';

	let { data } = $props();

	const set = $derived(data.set);
	// Local copies so drags show instantly; they snap back to the server's version whenever it reloads.
	let items = $derived(data.set.items);
	let rev = $derived(data.set.rev);

	const blockers = $derived(exportBlockers(items));
	const exportable = $derived(canExport(blockers));
	const vetoed = $derived(items.filter((i) => i.state === 'vetoed'));
	const inSet = $derived(new Set(items.map((i) => i.postId)));
	const rejected = $derived(new Set(set.rejected));

	// --- Saving the order ---------------------------------------------------------------------

	let saving = $state(false);
	let saveAgain = false;
	let savedAt = $state(0);

	const orderKey = () => items.map((i) => i.postId).join(',');

	async function saveOrder() {
		if (saving) {
			saveAgain = true;
			return;
		}
		saving = true;
		try {
			do {
				saveAgain = false;
				const r = await api<{ rev: number }>(`/api/sets/${set.id}/order`, {
					method: 'PUT',
					body: { rev, order: items.map((i) => i.postId) }
				});
				rev = r.rev;
			} while (saveAgain);
			savedAt = Date.now();
		} catch (e) {
			toastError(e);
			saving = false;
			await invalidateAll();
		} finally {
			saving = false;
		}
	}

	function move(from: number, to: number) {
		if (to < 0 || to >= items.length || from === to) return;
		const next = items.slice();
		const [m] = next.splice(from, 1);
		next.splice(to, 0, m!);
		items = next;
	}

	function nudge(i: number, by: number) {
		const to = i + by;
		if (to < 0 || to >= items.length) return;
		move(i, to);
		saveOrder();
	}

	// --- Drag to reorder (pointer events: works with mouse, pen and touch) ----------------------

	let listEl = $state<HTMLOListElement>();
	let dragId = $state<string | null>(null);
	let dragStart = '';

	function startDrag(e: PointerEvent, id: string) {
		if (e.button !== 0) return;
		e.preventDefault();
		(e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
		dragId = id;
		dragStart = orderKey();
	}

	function onDrag(e: PointerEvent) {
		if (!dragId || !listEl) return;
		const y = e.clientY;
		let target = 0;
		for (const row of listEl.querySelectorAll<HTMLElement>('[data-row]')) {
			if (row.dataset.row === dragId) continue;
			const b = row.getBoundingClientRect();
			if (y > b.top + b.height / 2) target++;
		}
		move(
			items.findIndex((i) => i.postId === dragId),
			target
		);
		if (y < 90) window.scrollBy(0, -14);
		else if (y > window.innerHeight - 110) window.scrollBy(0, 14);
	}

	function endDrag() {
		if (!dragId) return;
		dragId = null;
		if (orderKey() !== dragStart) saveOrder();
	}

	function handleKey(e: KeyboardEvent, i: number) {
		if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			nudge(i, e.key === 'ArrowUp' ? -1 : 1);
			// Keep focus on the handle of the row that moved.
			requestAnimationFrame(() => listEl?.querySelectorAll<HTMLElement>('[data-handle]')[i + (e.key === 'ArrowUp' ? -1 : 1)]?.focus());
		}
	}

	// Pick up reviews made elsewhere when coming back to the tab.
	$effect(() => {
		const onVis = () => {
			if (document.visibilityState === 'visible' && !dragId && !saving) invalidateAll();
		};
		document.addEventListener('visibilitychange', onVis);
		return () => document.removeEventListener('visibilitychange', onVis);
	});

	// --- Item actions -------------------------------------------------------------------------

	let busy = $state<string | null>(null);

	async function remove(it: SetItemView) {
		if (!confirm(`Remove image #${items.indexOf(it) + 1} from this set?`)) return;
		busy = it.postId;
		try {
			await api(`/api/sets/${set.id}/items/${it.postId}`, { method: 'DELETE' });
			await invalidateAll();
		} catch (e) {
			toastError(e);
		} finally {
			busy = null;
		}
	}

	// --- Image picker (add, or replace a vetoed image) ------------------------------------------

	const SOURCES = [
		{ id: 'picked', label: 'Picked' },
		{ id: 'new', label: 'New' },
		{ id: 'top', label: 'Top' }
	] as const;

	let picker = $state<HTMLDialogElement>();
	let replacing = $state<SetItemView | null>(null);
	let source = $state<(typeof SOURCES)[number]['id']>('picked');
	let candidates = $state<PostView[]>([]);
	let nextOffset = $state<number | null>(0);
	let loading = $state(false);
	let picking = $state<string | null>(null);

	async function loadMore(reset = false) {
		if (loading) return;
		if (reset) {
			candidates = [];
			nextOffset = 0;
		}
		if (nextOffset === null) return;
		loading = true;
		try {
			const r = await api<{ posts: PostView[]; nextOffset: number | null }>(`/api/posts?sort=${source}&offset=${nextOffset}`);
			const seen = new Set(candidates.map((p) => p.id));
			candidates = [...candidates, ...r.posts.filter((p) => p.kind === 'image' && !seen.has(p.id))];
			nextOffset = r.nextOffset;
		} catch (e) {
			toastError(e);
		} finally {
			loading = false;
		}
	}

	function openPicker(target: SetItemView | null) {
		replacing = target;
		picker?.showModal();
		if (!candidates.length) loadMore(true);
	}

	function setSource(id: typeof source) {
		if (id === source) return;
		source = id;
		loadMore(true);
	}

	async function pick(p: PostView) {
		picking = p.id;
		try {
			if (replacing) {
				const pos = items.findIndex((i) => i.postId === replacing!.postId) + 1;
				await api(`/api/sets/${set.id}/items/${replacing.postId}/replace`, { body: { postId: p.id } });
				picker?.close();
				toast(`Replaced #${pos}. The new image is waiting for a reviewer.`);
			} else {
				await api(`/api/sets/${set.id}/items`, { body: { postId: p.id } });
			}
			await invalidateAll();
		} catch (e) {
			toastError(e);
		} finally {
			picking = null;
		}
	}

	let addingAll = $state(false);
	async function addAllPicked() {
		addingAll = true;
		try {
			const r = await api<BulkAddResult>(`/api/sets/${set.id}/items`, { body: { from: 'picked' } });
			const skipped = [
				r.present && `${r.present} already in the set`,
				r.rejected && `${r.rejected} vetoed for this set`,
				r.full && `${r.full} over the ${SET_MAX_ITEMS}-image limit`,
				r.videos && `${r.videos} ${r.videos === 1 ? 'video' : 'videos'}`
			].filter(Boolean);
			toast(
				`${r.added ? `Added ${r.added} ${r.added === 1 ? 'image' : 'images'}, all pending review` : 'Nothing new to add'}${skipped.length ? `. Skipped ${skipped.join(', ')}` : ''}.`
			);
			await invalidateAll();
			if (r.added) picker?.close();
		} catch (e) {
			toastError(e);
		} finally {
			addingAll = false;
		}
	}

	// --- Set actions --------------------------------------------------------------------------

	let renaming = $state(false);
	let newName = $state('');

	async function rename(e: SubmitEvent) {
		e.preventDefault();
		try {
			await api(`/api/sets/${set.id}`, { method: 'PATCH', body: { name: newName } });
			renaming = false;
			await invalidateAll();
		} catch (err) {
			toastError(err);
		}
	}

	async function removeSet() {
		if (!confirm(`Delete “${set.name}”? The images stay on the board; only the set, its order and its reviews go.`)) return;
		try {
			await api(`/api/sets/${set.id}`, { method: 'DELETE' });
			await goto('/curate');
		} catch (e) {
			toastError(e);
		}
	}

	let exporting = $state(false);
	async function exportSet() {
		exporting = true;
		try {
			// Same checks as the download itself, but as JSON, so a failure shows up as a toast
			// instead of navigating to an error.
			await api(`/api/sets/${set.id}/export?check=1`);
			window.location.href = `/api/sets/${set.id}/export`;
		} catch (e) {
			toastError(e);
			await invalidateAll();
		} finally {
			exporting = false;
		}
	}

	// --- Photo viewer -------------------------------------------------------------------------

	const photos = $derived(
		items.flatMap((it, i) =>
			it.post ? [{ id: it.postId, src: it.post.mediaUrl, thumb: it.post.thumbUrl, alt: it.post.caption || `Image ${i + 1}`, it, position: i + 1 }] : []
		)
	);
	let viewing = $state<number | null>(null);
	const openViewer = (postId: string) => (viewing = photos.findIndex((p) => p.id === postId));

	// --- Display helpers ----------------------------------------------------------------------

	function stateLine(it: SetItemView) {
		if (it.state === 'approved') return `Approved by @${it.stateByName || 'someone'} · ${timeAgo(it.stateAt)}`;
		if (it.state === 'vetoed') return `Vetoed by @${it.stateByName || 'someone'} · ${timeAgo(it.stateAt)}`;
		return `${it.replaces ? 'Replacement added' : 'Added'} by @${it.addedByName || 'someone'} · waiting for a reviewer`;
	}

	const ACTION: Record<SetLogEntry['action'], string> = {
		create: 'created the set',
		rename: 'renamed the set',
		add: 'added',
		'add-many': 'added every picked image',
		remove: 'removed',
		replace: 'replaced a vetoed image with',
		reorder: 'reordered the images',
		approve: 'approved',
		veto: 'vetoed'
	};
</script>

<svelte:head><title>{set.name} · Curated sets · picslop</title></svelte:head>

<svelte:window onpointermove={onDrag} onpointerup={endDrag} onpointercancel={endDrag} />

<div class="mx-auto max-w-[1100px] px-4 md:px-6">
	<section class="pt-5 pb-4 md:pt-10 md:pb-6">
		<a href="/curate" class="label text-muted hover:underline">‹ curated sets</a>
		{#if renaming}
			<form class="mt-2 flex flex-col gap-2 md:flex-row" onsubmit={rename}>
				<input class="field md:max-w-lg" maxlength={SET_NAME_MAX} required bind:value={newName} aria-label="Set name" />
				<div class="flex gap-2">
					<button class="btn btn-ink" disabled={!newName.trim()}>Save</button>
					<button class="btn" type="button" onclick={() => (renaming = false)}>Cancel</button>
				</div>
			</form>
		{:else}
			<h1 class="display mt-1.5 text-[2.3rem] break-words md:mt-2 md:text-[4.2rem]">{set.name}</h1>
		{/if}
		<p class="mt-2 font-mono text-xs text-muted">
			{items.length} {items.length === 1 ? 'image' : 'images'} · started by @{set.createdByName || 'someone'} {timeAgo(set.createdAt)}
		</p>

		<div class="mt-4 flex flex-wrap items-center gap-2">
			<button class="btn btn-accent" onclick={() => openPicker(null)}>+ Add images</button>
			<button class="btn {exportable ? 'btn-ink' : ''}" onclick={exportSet} disabled={!exportable || exporting || saving} title={exportable ? 'Download the images and manifest.json' : blockerText(blockers)}>
				{exporting ? 'Checking…' : '⇩ Export'}
			</button>
			{#if data.isReviewer}<a class="btn" href="/review/{set.id}">Review this set</a>{/if}
			<span class="ml-auto flex gap-2">
				{#if !renaming}<button class="btn px-3 py-1.5 text-xs" onclick={() => ((newName = set.name), (renaming = true))}>Rename</button>{/if}
				<button class="btn btn-danger px-3 py-1.5 text-xs" onclick={removeSet}>Delete set</button>
			</span>
		</div>
		{#if !exportable}
			<p class="mt-2 text-sm text-muted">{blockerText(blockers)}</p>
		{/if}
	</section>

	<div class="mb-5 h-[3px] bg-ink"></div>

	{#if vetoed.length}
		<div class="mb-5 border-2 border-danger bg-danger/10 p-4 shadow-[4px_4px_0_0_var(--color-danger)]" role="alert">
			<p class="display text-xl text-danger">⚠ {vetoed.length} vetoed {vetoed.length === 1 ? 'image' : 'images'} in this set</p>
			<p class="mt-1 text-sm">
				A reviewer vetoed {vetoed.length === 1 ? 'an image' : 'images'} below. Replace each one with a different image; the replacement
				goes back to a reviewer. This set can't be exported until then.
			</p>
		</div>
	{/if}

	<div class="mb-2 flex items-baseline justify-between gap-3">
		<h2 class="label text-muted">video order · drag ⠿ to rearrange</h2>
		<p class="label text-muted" aria-live="polite">{saving ? 'saving…' : savedAt ? `order saved ${timeAgo(savedAt)}` : ''}</p>
	</div>

	{#if items.length}
		<ol bind:this={listEl} class="flex flex-col gap-2.5 {dragId ? 'select-none' : ''}">
			{#each items as it, i (it.postId)}
				<li
					data-row={it.postId}
					animate:flip={{ duration: dragId ? 0 : 180 }}
					class="box flex items-stretch gap-0 {it.state === 'vetoed' ? 'border-danger bg-danger/5' : ''} {dragId === it.postId
						? 'relative z-10 -rotate-1 shadow-hard-lg'
						: ''} {busy === it.postId ? 'opacity-50' : ''}"
				>
					<button
						data-handle
						class="flex w-9 shrink-0 cursor-grab touch-none items-center justify-center border-r-2 border-ink bg-paper-2 text-lg text-muted active:cursor-grabbing md:w-10"
						onpointerdown={(e) => startDrag(e, it.postId)}
						onkeydown={(e) => handleKey(e, i)}
						aria-label="Image {i + 1}. Drag, or use the arrow keys, to move it."
						title="Drag to reorder"
					>
						⠿
					</button>
					<div class="flex w-11 shrink-0 items-center justify-center font-mono text-lg font-bold md:w-14 md:text-2xl">{i + 1}</div>
					<div class="my-2 h-20 w-20 shrink-0 border-2 border-ink bg-paper-2 md:h-24 md:w-24">
						{#if it.post}
							<button class="block h-full w-full cursor-zoom-in" onclick={() => openViewer(it.postId)} aria-label="View image {i + 1} larger" title="View larger">
								<img src={it.post.thumbUrl} alt={it.post.caption || `Image ${i + 1}`} class="h-full w-full object-cover {it.state === 'vetoed' ? 'opacity-50 grayscale' : ''}" draggable="false" />
							</button>
						{:else}
							<div class="grid h-full place-items-center p-1 text-center text-[0.65rem] text-muted">deleted</div>
						{/if}
					</div>
					<div class="flex min-w-0 flex-1 flex-col justify-center gap-1 px-3 py-2">
						<div class="flex flex-wrap items-center gap-2">
							<StateBadge state={it.state} />
							{#if !it.post}<span class="label border-2 border-ink bg-ink px-1.5 py-0.5 text-paper">post deleted</span>{/if}
						</div>
						<p class="truncate font-mono text-xs text-muted">{stateLine(it)}</p>
						{#if it.state === 'vetoed' && it.reason}
							<p class="text-sm text-danger"><span class="label">reason:</span> “{it.reason}”</p>
						{/if}
						{#if it.post?.caption}<p class="truncate text-sm">{it.post.caption}</p>{/if}
					</div>
					<div class="flex shrink-0 flex-col items-end justify-center gap-1.5 py-2 pr-2 md:flex-row md:items-center md:pr-3">
						<div class="flex gap-1">
							<button class="btn px-2 py-1 text-xs" onclick={() => nudge(i, -1)} disabled={i === 0} aria-label="Move image {i + 1} up">↑</button>
							<button class="btn px-2 py-1 text-xs" onclick={() => nudge(i, 1)} disabled={i === items.length - 1} aria-label="Move image {i + 1} down">↓</button>
						</div>
						{#if it.state === 'vetoed'}
							<button class="btn btn-ink px-2.5 py-1 text-xs" onclick={() => openPicker(it)} disabled={busy === it.postId}>Replace…</button>
						{:else}
							<button class="btn btn-danger px-2 py-1 text-xs" onclick={() => remove(it)} disabled={busy === it.postId}>Remove</button>
						{/if}
					</div>
				</li>
			{/each}
		</ol>
	{:else}
		<div class="box p-8 text-center">
			<p class="text-muted">This set is empty.</p>
			<button class="btn btn-accent mt-3" onclick={() => openPicker(null)}>+ Add images</button>
		</div>
	{/if}

	{#if data.log.length}
		<details class="mt-8 mb-10">
			<summary class="label cursor-pointer text-muted">activity</summary>
			<ul class="mt-2 divide-y divide-line border-t-2 border-ink text-sm">
				{#each data.log as e, k (k)}
					<li class="flex flex-wrap gap-x-2 py-1.5">
						<span class="font-mono text-xs text-muted">{timeAgo(e.at)}</span>
						<span><b>@{e.byName || 'someone'}</b> {ACTION[e.action]}{#if e.count} ({e.count}){/if}{#if e.postId && e.action !== 'reorder'} <a class="font-mono text-xs underline" href="/p/{e.postId}">{e.postId}</a>{/if}{#if e.replaced} (out: <span class="font-mono text-xs">{e.replaced}</span>){/if}{#if e.reason} — “{e.reason}”{/if}</span>
					</li>
				{/each}
			</ul>
		</details>
	{/if}
</div>

<PhotoViewer {photos} bind:index={viewing}>
	{#snippet info(p)}
		<p class="display text-2xl">#{p.position}</p>
		<div><StateBadge state={p.it.state} /></div>
		<p class="font-mono text-xs text-muted">{stateLine(p.it)}</p>
		{#if p.it.state === 'vetoed' && p.it.reason}
			<p class="text-sm text-danger"><span class="label">reason:</span> “{p.it.reason}”</p>
		{/if}
		{#if p.it.post?.caption}<p class="text-sm">{p.it.post.caption}</p>{/if}
		<p class="font-mono text-xs text-muted">by @{p.it.post?.authorName || 'someone'}{#if p.it.post?.width} · {p.it.post.width}×{p.it.post.height}{/if}</p>
	{/snippet}
	{#snippet actions(p)}
		{#if p.it.state === 'vetoed'}
			<button class="btn btn-ink w-full px-2.5 py-1.5 text-xs" onclick={() => ((viewing = null), openPicker(p.it))}>Replace…</button>
		{/if}
	{/snippet}
</PhotoViewer>

<dialog bind:this={picker} class="box m-auto max-h-[min(44rem,calc(100svh-2rem))] w-[min(56rem,calc(100vw-2rem))] p-0 backdrop:bg-ink/50" onclose={() => (replacing = null)}>
	<div class="flex max-h-[min(44rem,calc(100svh-2rem))] flex-col">
		<div class="flex flex-wrap items-center gap-2 border-b-2 border-ink p-4">
			<div class="min-w-0 flex-1">
				{#if replacing}
					<p class="label text-danger">replace vetoed image #{items.findIndex((i) => i.postId === replacing?.postId) + 1}</p>
					<h2 class="display mt-1 text-2xl">Pick a different image</h2>
				{:else}
					<p class="label text-muted">add to {set.name}</p>
					<h2 class="display mt-1 text-2xl">Pick images</h2>
				{/if}
			</div>
			<button class="btn px-3 py-1.5 text-xs" onclick={() => picker?.close()}>Done</button>
		</div>
		<div class="flex flex-wrap items-center gap-2 px-4 pt-3">
			{#each SOURCES as s (s.id)}
				<button class="btn px-3 py-1.5 text-xs {source === s.id ? 'btn-ink' : ''}" onclick={() => setSource(s.id)} aria-pressed={source === s.id}>{s.label}</button>
			{/each}
			{#if source === 'picked' && !replacing}
				<button
					class="btn btn-accent ml-auto px-3 py-1.5 text-xs"
					onclick={addAllPicked}
					disabled={addingAll || picking !== null}
					title="Append every image on the Picked board that isn't in this set yet"
				>
					{addingAll ? 'Adding…' : '+ Add all picked'}
				</button>
			{/if}
		</div>
		<div class="overflow-y-auto p-4">
			<ul class="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-6">
				{#each candidates as p (p.id)}
					{@const here = inSet.has(p.id)}
					{@const out = rejected.has(p.id)}
					<li>
						<button
							class="relative block aspect-square w-full border-2 border-ink bg-paper-2 disabled:cursor-not-allowed"
							onclick={() => pick(p)}
							disabled={here || out || picking !== null}
							title={here ? 'Already in this set' : out ? 'Vetoed for this set' : p.caption || 'Add'}
						>
							<img src={p.thumbUrl} alt={p.caption} class="h-full w-full object-cover {here || out ? 'opacity-35' : ''}" loading="lazy" />
							{#if here}<span class="label absolute inset-x-0 bottom-0 bg-lime px-1 py-0.5 text-[0.6rem]">in set</span>{/if}
							{#if out}<span class="label absolute inset-x-0 bottom-0 bg-danger px-1 py-0.5 text-[0.6rem] text-paper">vetoed</span>{/if}
							{#if picking === p.id}<span class="label absolute inset-0 grid place-items-center bg-card/70">…</span>{/if}
						</button>
					</li>
				{/each}
			</ul>
			{#if loading}
				<p class="py-6 text-center text-sm text-muted">Loading…</p>
			{:else if nextOffset !== null}
				<div class="mt-4 text-center"><button class="btn px-3 py-1.5 text-xs" onclick={() => loadMore()}>Load more</button></div>
			{:else if !candidates.length}
				<p class="py-6 text-center text-sm text-muted">No images on this board.</p>
			{/if}
		</div>
	</div>
</dialog>
