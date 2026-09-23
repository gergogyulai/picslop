<script lang="ts">
	import { api } from '$lib/api';
	import { compact } from '$lib/format';
	import { toastError } from '$lib/toast.svelte';

	let {
		postId,
		up = $bindable(0),
		down = $bindable(0),
		myVote = $bindable<-1 | 0 | 1>(0),
		size = 'sm'
	}: { postId: string; up?: number; down?: number; myVote?: -1 | 0 | 1; size?: 'sm' | 'lg' } = $props();

	let busy = $state(false);
	const score = $derived(up - down);

	/** Used by double-tap-to-like: only ever turns an upvote on. */
	export function upvote() {
		if (myVote !== 1) cast(1);
	}

	async function cast(dir: 1 | -1) {
		if (busy) return;
		const next = myVote === dir ? 0 : dir;
		const prev = { up, down, myVote };
		// Optimistic update
		up += (next === 1 ? 1 : 0) - (myVote === 1 ? 1 : 0);
		down += (next === -1 ? 1 : 0) - (myVote === -1 ? 1 : 0);
		myVote = next;
		busy = true;
		try {
			const res = await api<{ up: number; down: number; myVote: -1 | 0 | 1 }>(`/api/posts/${postId}/vote`, {
				body: { value: next }
			});
			({ up, down, myVote } = res);
		} catch (e) {
			({ up, down, myVote } = prev);
			toastError(e);
		} finally {
			busy = false;
		}
	}
</script>

<div
	class="inline-flex items-stretch border-2 border-ink bg-card {size === 'lg'
		? 'min-h-11 text-lg pointer-coarse:min-h-12'
		: 'min-h-7 text-sm pointer-coarse:min-h-10'}"
	role="group"
	aria-label="Vote"
>
	<button
		class="grid place-items-center transition-colors {size === 'lg' ? 'w-12 pointer-coarse:w-14' : 'w-8 pointer-coarse:w-10'} {myVote === 1 ? 'bg-accent' : 'hover:bg-paper-2'}"
		aria-pressed={myVote === 1}
		aria-label="Upvote"
		onclick={(e) => {
			e.preventDefault();
			e.stopPropagation();
			cast(1);
		}}
	>
		<svg width={size === 'lg' ? 18 : 12} height={size === 'lg' ? 18 : 12} viewBox="0 0 12 12" aria-hidden="true"><path d="M6 1 11 10H1Z" fill="currentColor" /></svg>
	</button>
	<span
		class="grid min-w-[2.6em] place-items-center border-x-2 border-ink px-1.5 font-mono font-semibold tabular-nums {score < 0 ? 'text-down' : ''}"
		title="{up} up · {down} down"
	>
		{compact(score)}
	</span>
	<button
		class="grid place-items-center transition-colors {size === 'lg' ? 'w-12 pointer-coarse:w-14' : 'w-8 pointer-coarse:w-10'} {myVote === -1 ? 'bg-down text-paper' : 'hover:bg-paper-2'}"
		aria-pressed={myVote === -1}
		aria-label="Downvote"
		onclick={(e) => {
			e.preventDefault();
			e.stopPropagation();
			cast(-1);
		}}
	>
		<svg width={size === 'lg' ? 18 : 12} height={size === 'lg' ? 18 : 12} viewBox="0 0 12 12" aria-hidden="true"><path d="M6 11 1 2h10Z" fill="currentColor" /></svg>
	</button>
</div>
