<script lang="ts">
	import { page } from '$app/state';

	let { userId }: { userId: string } = $props();

	const path = $derived(page.url.pathname);
	const onBoard = $derived(path === '/' || path.startsWith('/p/'));
	const onUpload = $derived(path === '/upload');
	const onMe = $derived(path === `/u/${userId}`);
</script>

<nav
	class="fixed inset-x-0 bottom-0 z-40 border-t-2 border-ink bg-paper/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-[2px] sm:hidden"
	aria-label="Main"
>
	<div class="grid h-16 grid-cols-3 items-stretch">
		<a href="/" class="tab {onBoard ? 'on' : ''}" aria-current={onBoard ? 'page' : undefined}>
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
				<rect x="3" y="3" width="7.5" height="10" /><rect x="13.5" y="3" width="7.5" height="6" /><rect x="3" y="16" width="7.5" height="5" /><rect x="13.5" y="12" width="7.5" height="9" />
			</svg>
			<span>Board</span>
		</a>

		<a href="/upload" class="group grid place-items-center" aria-current={onUpload ? 'page' : undefined} aria-label="Upload">
			<span
				class="-mt-6 grid h-14 w-14 place-items-center border-2 border-ink bg-accent shadow-hard transition-transform group-active:translate-x-0.5 group-active:translate-y-0.5 group-active:shadow-none {onUpload
					? 'rotate-0 bg-lime'
					: '-rotate-3'}"
			>
				<svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" aria-hidden="true"><path d="M12 5v14M5 12h14" /></svg>
			</span>
		</a>

		<a href="/u/{userId}" class="tab {onMe ? 'on' : ''}" aria-current={onMe ? 'page' : undefined}>
			<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true">
				<circle cx="12" cy="8" r="4" /><path d="M4 21c1.5-4 4.5-6 8-6s6.5 2 8 6" />
			</svg>
			<span>You</span>
		</a>
	</div>
</nav>

<style>
	.tab {
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 2px;
		font-family: var(--font-mono);
		font-size: 0.66rem;
		letter-spacing: 0.06em;
		text-transform: uppercase;
		color: var(--color-muted);
		position: relative;
	}
	.tab.on {
		color: var(--color-ink);
		font-weight: 600;
	}
	.tab.on::after {
		content: '';
		position: absolute;
		top: 0;
		left: 30%;
		right: 30%;
		height: 4px;
		background: var(--color-accent);
	}
</style>
