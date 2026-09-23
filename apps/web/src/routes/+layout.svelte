<script lang="ts">
	import '../app.css';
	import Header from '$lib/components/Header.svelte';
	import MobileNav from '$lib/components/MobileNav.svelte';
	import Toasts from '$lib/components/Toasts.svelte';

	let { data, children } = $props();
</script>

<svelte:head>
	<title>picslop</title>
</svelte:head>

{#if data.user}
	<Header user={data.user} isAdmin={data.isAdmin} />
{/if}

<!-- On phones, leave room for the bottom tab bar (and the home indicator). -->
<main class={data.user ? 'max-sm:pb-[calc(4rem+env(safe-area-inset-bottom))]' : ''}>
	{@render children()}
</main>

{#if data.user}
	<MobileNav userId={data.user.id} />
{/if}

<Toasts />
