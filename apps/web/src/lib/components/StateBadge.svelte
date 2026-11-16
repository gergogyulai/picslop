<script lang="ts">
	import type { ItemState } from '$lib/sets';

	let { state, class: cls = '' }: { state: ItemState; class?: string } = $props();

	const STYLE: Record<ItemState, string> = {
		pending: 'bg-paper-2 text-ink border-dashed',
		approved: 'bg-lime text-ink',
		vetoed: 'bg-danger text-paper border-danger'
	};
	const LABEL: Record<ItemState, string> = { pending: '◌ pending', approved: '✓ approved', vetoed: '✕ vetoed' };
</script>

<span class="label inline-block border-2 border-ink px-1.5 py-0.5 whitespace-nowrap {STYLE[state]} {cls}">{LABEL[state]}</span>
