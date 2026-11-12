<script lang="ts">
	import { page } from '$app/state';

	let { children } = $props();

	const tabs = [
		{ href: '/admin', label: 'Overview' },
		{ href: '/admin/users', label: 'Users' }
	];
</script>

<div class="mx-auto max-w-[1400px] px-4 md:px-6">
	<section class="flex flex-col gap-4 pt-5 pb-4 md:flex-row md:items-end md:justify-between md:pt-12 md:pb-6">
		<div>
			<p class="label text-muted">admin</p>
			<h1 class="display mt-1.5 text-[2.6rem] md:mt-2 md:text-[5.5rem]">Dashboard</h1>
		</div>
		<nav class="flex gap-2" aria-label="Admin sections">
			{#each tabs as t (t.href)}
				{@const on = page.url.pathname === t.href}
				<a href={t.href} class="btn {on ? 'btn-ink -rotate-1' : ''}" aria-current={on ? 'page' : undefined}>{t.label}</a>
			{/each}
		</nav>
	</section>

	<div class="mb-5 h-[3px] bg-ink md:mb-8"></div>

	{@render children()}
</div>
