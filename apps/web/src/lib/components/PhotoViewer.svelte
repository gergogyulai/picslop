<script lang="ts" generics="T extends { id: string; src: string; thumb?: string; alt: string }">
	import type { Snippet } from 'svelte';

	/**
	 * Full-screen viewer for a list of photos. `index` is the open photo (null = closed).
	 * ← / → (or swipe) step through, Esc closes. `info` and `actions` render beside the image.
	 */
	let {
		photos,
		index = $bindable(null),
		info,
		actions
	}: {
		photos: T[];
		index: number | null;
		info?: Snippet<[T, number]>;
		actions?: Snippet<[T, number]>;
	} = $props();

	let dialog = $state<HTMLDialogElement>();
	const photo = $derived(index !== null ? photos[index] : undefined);
	let loaded = $state(false);

	// Open/close the native dialog to follow `index`; close if the list shrinks under us.
	$effect(() => {
		if (!dialog) return;
		if (photo && !dialog.open) dialog.showModal();
		else if (!photo && dialog.open) dialog.close();
	});

	// Keep the index in range when the list changes (e.g. a filter drops the open photo).
	$effect(() => {
		if (index !== null && photos.length && index >= photos.length) index = photos.length - 1;
		else if (index !== null && !photos.length) index = null;
	});

	$effect(() => {
		void photo?.src;
		loaded = false;
	});

	// Preload the neighbours so stepping through feels instant.
	$effect(() => {
		if (index === null) return;
		for (const k of [index - 1, index + 1]) {
			const p = photos[k];
			if (p) new Image().src = p.src;
		}
	});

	function step(by: number) {
		if (index === null || !photos.length) return;
		const next = index + by;
		if (next >= 0 && next < photos.length) index = next;
	}

	function onKey(e: KeyboardEvent) {
		if ((e.target as HTMLElement)?.closest('input, textarea, select')) return;
		if (e.key === 'ArrowLeft') {
			e.preventDefault();
			step(-1);
		} else if (e.key === 'ArrowRight') {
			e.preventDefault();
			step(1);
		}
	}

	let touchX: number | null = null;
	function onTouchStart(e: TouchEvent) {
		touchX = e.touches.length === 1 ? e.touches[0]!.clientX : null;
	}
	function onTouchEnd(e: TouchEvent) {
		if (touchX === null) return;
		const dx = e.changedTouches[0]!.clientX - touchX;
		touchX = null;
		if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
	}
</script>

<dialog
	bind:this={dialog}
	class="m-0 h-svh max-h-none w-screen max-w-none bg-transparent p-0 backdrop:bg-ink/85"
	onclose={() => (index = null)}
	onkeydown={onKey}
	aria-label="Photo viewer"
>
	{#if photo && index !== null}
		<div class="flex h-full flex-col md:flex-row">
			<!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
			<div
				class="relative flex min-h-0 flex-1 items-center justify-center p-3 md:p-6"
				onclick={(e) => e.target === e.currentTarget && (index = null)}
				ontouchstart={onTouchStart}
				ontouchend={onTouchEnd}
			>
				{#if !loaded && photo.thumb}
					<img src={photo.thumb} alt="" class="absolute max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] object-contain opacity-60 blur-sm md:max-h-[calc(100%-3rem)] md:max-w-[calc(100%-3rem)]" />
				{/if}
				{#key photo.src}
					<img
						src={photo.src}
						alt={photo.alt}
						class="relative max-h-full max-w-full border-2 border-ink bg-paper-2 object-contain shadow-hard-lg"
						onload={() => (loaded = true)}
					/>
				{/key}

				{#if index > 0}
					<button class="btn absolute top-1/2 left-2 -translate-y-1/2 px-3 py-2 text-lg md:left-4" onclick={() => step(-1)} aria-label="Previous photo">‹</button>
				{/if}
				{#if index < photos.length - 1}
					<button class="btn absolute top-1/2 right-2 -translate-y-1/2 px-3 py-2 text-lg md:right-4" onclick={() => step(1)} aria-label="Next photo">›</button>
				{/if}
			</div>

			<aside class="box flex max-h-[45svh] shrink-0 flex-col gap-3 overflow-y-auto border-x-0 border-b-0 p-4 md:max-h-none md:w-80 md:border-y-0 md:border-r-0">
				<div class="flex items-center justify-between gap-2">
					<span class="label text-muted">{index + 1} / {photos.length}</span>
					<div class="flex gap-1.5">
						<a class="btn px-2 py-1 text-xs" href={photo.src} target="_blank" rel="noopener" title="Open the original in a new tab">↗ Full size</a>
						<button class="btn btn-ink px-2 py-1 text-xs" onclick={() => (index = null)} aria-label="Close viewer">✕</button>
					</div>
				</div>
				{@render info?.(photo, index)}
				{#if actions}<div class="mt-auto pt-2">{@render actions(photo, index)}</div>{/if}
				<p class="hidden font-mono text-[0.65rem] text-muted md:block">← → to step · esc to close</p>
			</aside>
		</div>
	{/if}
</dialog>
