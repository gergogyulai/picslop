<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import StateBadge from '$lib/components/StateBadge.svelte';
	import { timeAgo } from '$lib/format';
	import { VETO_REASON_MAX, type ItemState, type SetItemView } from '$lib/sets';
	import { toastError } from '$lib/toast.svelte';

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
</script>

<svelte:head><title>Review {set.name} · picslop</title></svelte:head>

<div class="mx-auto max-w-[1400px] px-4 md:px-6">
	<section class="pt-5 pb-4 md:pt-10 md:pb-6">
		<a href="/review" class="label text-muted hover:underline">‹ all sets</a>
		<h1 class="display mt-1.5 text-[2.3rem] break-words md:mt-2 md:text-[4.2rem]">{set.name}</h1>
		<p class="mt-2 max-w-prose text-sm text-muted">
			You're judging the images, not their order: curators can rearrange the set without sending anything back to you.
		</p>
	</section>

	<div class="mb-5 h-[3px] bg-ink"></div>

	<div class="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:px-0">
		{#each FILTERS as f (f.id)}
			<button class="btn shrink-0 px-3 py-1.5 text-xs whitespace-nowrap {filter === f.id ? 'btn-ink' : ''}" onclick={() => (filter = f.id)} aria-pressed={filter === f.id}>
				{f.label} <span class="font-mono opacity-70">{counts[f.id]}</span>
			</button>
		{/each}
	</div>

	<ul class="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
		{#each shown as it (it.postId)}
			{@const p = it.post!}
			<li class="box flex flex-col {it.state === 'vetoed' ? 'border-danger' : ''} {busy === it.postId ? 'opacity-50' : ''}">
				<a href={p.mediaUrl} target="_blank" rel="noopener" class="block border-b-2 border-ink bg-paper-2" title="Open full size">
					<img src={p.thumbUrl} alt={p.caption || `Image ${it.position}`} class="aspect-square w-full object-cover" loading="lazy" />
				</a>
				<div class="flex flex-1 flex-col gap-1.5 p-3">
					<div class="flex items-center justify-between gap-2">
						<StateBadge state={it.state} />
						<span class="label text-muted">#{it.position}</span>
					</div>
					{#if p.caption}<p class="line-clamp-2 text-sm">{p.caption}</p>{/if}
					<p class="font-mono text-xs text-muted">
						by @{p.authorName || 'someone'} · added by @{it.addedByName || 'someone'}
					</p>
					{#if it.state !== 'pending'}
						<p class="font-mono text-xs text-muted">{it.state} by @{it.stateByName || 'someone'} · {timeAgo(it.stateAt)}</p>
					{/if}
					{#if it.state === 'vetoed' && it.reason}<p class="text-sm text-danger">“{it.reason}”</p>{/if}

					<div class="mt-auto pt-2">
						{#if vetoing === it.postId}
							<form
								class="flex flex-col gap-2"
								onsubmit={(e) => {
									e.preventDefault();
									judge(it, 'vetoed', reason);
								}}
							>
								<input class="field py-2 text-sm" maxlength={VETO_REASON_MAX} placeholder="Reason (optional)" bind:value={reason} aria-label="Veto reason (optional)" />
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
