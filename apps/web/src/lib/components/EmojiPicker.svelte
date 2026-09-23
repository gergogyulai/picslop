<script lang="ts">
	import { onDestroy } from 'svelte';

	let {
		onpick,
		disabled = false
	}: { onpick: (emoji: string) => void; disabled?: boolean } = $props();

	let open = $state(false);
	let alignRight = $state(false);
	let loading = $state(false);
	let host = $state<HTMLDivElement>();
	let root = $state<HTMLDivElement>();
	let picker: HTMLElement | null = null;

	async function ensurePicker() {
		if (picker || !host) return;
		loading = true;
		try {
			// Loaded on first open only: the picker + emoji data are ~500 KB and cached in IndexedDB afterwards.
			const [{ Picker }, { default: dataSource }] = await Promise.all([
				import('emoji-picker-element'),
				import('emoji-picker-element-data/en/emojibase/data.json?url')
			]);
			picker = new Picker({ dataSource, locale: 'en' }) as unknown as HTMLElement;
			picker.classList.add('light');
			picker.addEventListener('emoji-click', (e) => {
				const unicode = (e as CustomEvent<{ unicode?: string }>).detail.unicode;
				if (unicode) {
					onpick(unicode);
					open = false;
				}
			});
			host.appendChild(picker);
		} finally {
			loading = false;
		}
	}

	async function toggle() {
		open = !open;
		if (open) {
			const rect = root?.getBoundingClientRect();
			alignRight = !!rect && rect.left + 380 > window.innerWidth;
			await ensurePicker();
			// Focus the search box so people can type right away.
			requestAnimationFrame(() => picker?.shadowRoot?.querySelector<HTMLInputElement>('input')?.focus());
		}
	}

	function onWindowPointer(e: PointerEvent) {
		if (open && root && !root.contains(e.target as Node)) open = false;
	}

	onDestroy(() => picker?.remove());
</script>

<svelte:window
	onpointerdown={onWindowPointer}
	onkeydown={(e) => {
		if (open && e.key === 'Escape') open = false;
	}}
/>

<div class="relative" bind:this={root}>
	<button
		type="button"
		class="flex h-full min-h-[2.1rem] items-center pointer-coarse:min-h-10 pointer-coarse:px-3 gap-1 border-2 border-dashed border-ink px-2 py-1 font-mono text-sm font-semibold transition-colors hover:bg-lime {open
			? 'bg-lime'
			: ''}"
		aria-haspopup="dialog"
		aria-expanded={open}
		aria-label="React with any emoji"
		title="React with any emoji"
		{disabled}
		onclick={toggle}
	>
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" aria-hidden="true">
			<circle cx="12" cy="12" r="9" /><path d="M8.5 14.5s1.3 2 3.5 2 3.5-2 3.5-2" /><path d="M9 9.5h.01M15 9.5h.01" stroke-width="3" stroke-linecap="round" />
		</svg>
		<span aria-hidden="true">+</span>
	</button>

	<div
		class="emoji-pop box z-50 {open ? '' : 'hidden'} {alignRight ? 'align-right' : ''}"
		role="dialog"
		aria-label="Pick an emoji"
	>
		{#if loading}
			<p class="label p-6 text-center text-muted">loading emoji…</p>
		{/if}
		<div bind:this={host}></div>
	</div>
</div>

<style>
	.emoji-pop {
		position: absolute;
		left: 0;
		top: calc(100% + 8px);
		padding: 0;
		overflow: hidden;
	}

	.emoji-pop.align-right {
		left: auto;
		right: 0;
	}

	/* On phones: a bottom sheet instead of a popover that could fall off-screen. */
	@media (max-width: 640px) {
		.emoji-pop,
		.emoji-pop.align-right {
			position: fixed;
			top: auto;
			left: 8px;
			right: 8px;
			bottom: 8px;
		}
		.emoji-pop :global(emoji-picker) {
			width: 100%;
			--num-columns: 8;
		}
	}

	.emoji-pop :global(emoji-picker) {
		--background: var(--color-card);
		--border-color: var(--color-ink);
		--border-size: 0;
		--border-radius: 0;
		--indicator-color: var(--color-accent);
		--indicator-height: 3px;
		--input-border-color: var(--color-ink);
		--input-border-size: 2px;
		--input-border-radius: 0;
		--input-font-color: var(--color-ink);
		--input-placeholder-color: var(--color-muted);
		--outline-color: var(--color-accent);
		--button-hover-background: var(--color-paper-2);
		--button-active-background: var(--color-lime);
		--category-font-color: var(--color-muted);
		--category-font-size: 0.7rem;
		--emoji-size: 1.45rem;
		--num-columns: 9;
		height: 360px;
	}
</style>
