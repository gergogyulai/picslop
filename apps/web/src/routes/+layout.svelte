<script lang="ts">
	import '../app.css';
	import { page } from '$app/state';
	import Header from '$lib/components/Header.svelte';
	import MobileNav from '$lib/components/MobileNav.svelte';
	import Toasts from '$lib/components/Toasts.svelte';

	let { data, children } = $props();

	const description = 'Members-only image board. Post pictures and clips, vote on everything, argue in the comments.';
</script>

<svelte:head>
	<title>picslop</title>
	<!-- Link unfurlers get redirected to /login, so these static tags are what every shared link shows.
	     Kept generic on purpose: nothing behind the login should leak into previews. -->
	<meta name="description" content={description} />
	<meta property="og:type" content="website" />
	<meta property="og:site_name" content="picslop" />
	<meta property="og:title" content="picslop" />
	<meta property="og:description" content={description} />
	<meta property="og:url" content={page.url.origin} />
	<meta property="og:image" content={`${page.url.origin}/og.png`} />
	<meta property="og:image:type" content="image/png" />
	<meta property="og:image:width" content="1200" />
	<meta property="og:image:height" content="630" />
	<meta property="og:image:alt" content="picslop — members-only image board" />
	<meta name="twitter:card" content="summary_large_image" />
	<meta name="twitter:title" content="picslop" />
	<meta name="twitter:description" content={description} />
	<meta name="twitter:image" content={`${page.url.origin}/og.png`} />
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
