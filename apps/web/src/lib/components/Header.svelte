<script lang="ts">
	import { page } from '$app/state';
	import { signOut } from '$lib/session';

	let { user, isAdmin }: { user: { id: string; name: string; email: string }; isAdmin: boolean } = $props();

	// Phones: tuck the header away while scrolling down, bring it back on any upward scroll.
	let hidden = $state(false);
	let lastY = 0;
	function onScroll() {
		const y = window.scrollY;
		if (Math.abs(y - lastY) < 6) return;
		hidden = y > lastY && y > 80;
		lastY = y;
	}
	$effect(() => {
		// Navigating always shows it again.
		void page.url.pathname;
		hidden = false;
	});
</script>

<svelte:window onscroll={onScroll} />

<header
	class="sticky top-0 z-40 border-b-2 border-ink bg-paper/95 pt-[env(safe-area-inset-top)] backdrop-blur-[2px] transition-transform duration-200 max-sm:will-change-transform {hidden
		? 'max-sm:-translate-y-full'
		: ''}"
>
	<div class="mx-auto flex max-w-[1400px] items-center gap-3 px-4 py-2.5 md:px-6 md:py-3">
		<a href="/" class="group flex items-baseline gap-2" aria-label="picslop home">
			<span class="display text-[1.7rem] transition-transform group-hover:-rotate-2 md:text-[2.3rem]">Pic<span class="text-accent">slop</span></span>
		</a>
		{#if isAdmin}<span class="label bg-lime px-1 text-[0.6rem] sm:hidden">admin</span>{/if}

		<!-- Phones use the bottom tab bar instead -->
		<nav class="ml-auto hidden items-center gap-2 sm:flex md:gap-3">
			<a href="/upload" class="btn btn-accent" aria-current={page.url.pathname === '/upload' ? 'page' : undefined}>
				<span aria-hidden="true" class="text-lg leading-none">+</span>
				<span>Upload</span>
			</a>
			<a href="/u/{user.id}" class="btn max-w-[30vw] truncate" title={user.email}>
				<span class="truncate normal-case">{user.name}</span>
				{#if isAdmin}<span class="label bg-lime px-1 text-[0.6rem]">admin</span>{/if}
			</a>
			<button class="btn px-3" onclick={signOut} title="Sign out" aria-label="Sign out">
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M15 3h4a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-4M10 17l5-5-5-5M15 12H3" /></svg>
			</button>
		</nav>
	</div>
</header>
