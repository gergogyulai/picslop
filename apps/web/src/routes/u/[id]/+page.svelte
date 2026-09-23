<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import PostCard from '$lib/components/PostCard.svelte';
	import type { PostView } from '$lib/constants';
	import { signOut } from '$lib/session';
	import { toast, toastError } from '$lib/toast.svelte';

	let { data } = $props();

	let posts = $derived.by(() => {
		const list = $state(structuredClone(data.posts));
		return list;
	});
	let nextOffset = $derived(data.nextOffset);
	let loading = $state(false);

	const isAdmin = $derived(page.data.isAdmin as boolean);
	const score = $derived(posts.reduce((s, p) => s + p.score, 0));

	async function loadMore() {
		if (loading || nextOffset === null) return;
		loading = true;
		try {
			const res = await api<{ posts: PostView[]; nextOffset: number | null }>(
				`/api/posts?sort=new&user=${encodeURIComponent(data.userId)}&offset=${nextOffset}`
			);
			posts.push(...res.posts);
			nextOffset = res.nextOffset;
		} catch (e) {
			toastError(e);
		} finally {
			loading = false;
		}
	}

	async function toggleBan() {
		try {
			await api(`/api/users/${data.userId}/ban`, { body: { banned: !data.banned } });
			toast(data.banned ? 'Ban lifted.' : 'User banned.');
			await invalidateAll();
		} catch (e) {
			toastError(e);
		}
	}
</script>

<svelte:head><title>{data.name ? `@${data.name}` : 'User'} · picslop</title></svelte:head>

<div class="mx-auto max-w-[1400px] px-4 md:px-6">
	<section class="flex flex-col gap-4 pt-5 pb-4 md:flex-row md:items-end md:justify-between md:pt-12 md:pb-6">
		<div class="min-w-0">
			<p class="label text-muted">{data.isMe ? 'your uploads' : 'uploads by'}</p>
			<h1 class="display mt-1.5 truncate text-[2.2rem] normal-case md:mt-2 md:text-[4.5rem]">@{data.name ?? 'unknown'}</h1>
			{#if data.banned}
				<p class="label mt-3 inline-block bg-accent px-2 py-1">
					{data.isMe ? 'Your account is restricted: you can browse but not post, vote or comment.' : 'banned'}
				</p>
			{/if}
		</div>
		<div class="flex flex-wrap items-center gap-2 md:gap-3">
			<span class="box px-3 py-2 font-mono text-sm"><b>{posts.length}{nextOffset !== null ? '+' : ''}</b> posts</span>
			<span class="box px-3 py-2 font-mono text-sm"><b>{score}</b> points</span>
			{#if isAdmin && !data.isMe}
				<button class="btn" onclick={toggleBan}>{data.banned ? 'Unban' : 'Ban'}</button>
			{/if}
			{#if data.isMe}
				<!-- The header's sign-out button is hidden on phones -->
				<button class="btn ml-auto sm:hidden" onclick={signOut}>Sign out</button>
			{/if}
		</div>
	</section>

	<div class="mb-4 h-[3px] bg-ink md:mb-6"></div>

	{#if posts.length === 0}
		<div class="mx-auto my-16 max-w-md text-center">
			<p class="display text-4xl">No uploads</p>
			{#if data.isMe}<a href="/upload" class="btn btn-accent mt-6">Upload your first</a>{/if}
		</div>
	{:else}
		<div class="columns-2 gap-3 sm:gap-4 md:columns-3 md:gap-5 xl:columns-4 2xl:columns-5">
			{#each posts as post, i (post.id)}
				<PostCard {post} index={i} />
			{/each}
		</div>
		{#if nextOffset !== null}
			<div class="flex justify-center py-10">
				<button class="btn" onclick={loadMore} disabled={loading}>{loading ? 'Loading…' : 'Load more'}</button>
			</div>
		{/if}
	{/if}
</div>
