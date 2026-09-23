<script lang="ts">
	import { toasts } from '$lib/toast.svelte';
	import { fly } from 'svelte/transition';
</script>

<div class="pointer-events-none fixed bottom-[calc(1rem+env(safe-area-inset-bottom))] left-1/2 z-50 max-sm:bottom-[calc(5rem+env(safe-area-inset-bottom))] flex w-[min(92vw,420px)] -translate-x-1/2 flex-col gap-2" aria-live="polite">
	{#each toasts as t (t.id)}
		<div
			transition:fly={{ y: 20, duration: 180 }}
			class="box pointer-events-auto px-4 py-3 text-sm font-semibold {t.tone === 'error' ? 'bg-accent!' : ''}"
			role={t.tone === 'error' ? 'alert' : 'status'}
		>
			{t.text}
		</div>
	{/each}
</div>
