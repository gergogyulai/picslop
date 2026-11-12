<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient, passkeysSupported } from '$lib/auth-client';
	import { timeAgo } from '$lib/format';
	import { addPasskey } from '$lib/passkeys';
	import { signOut } from '$lib/session';
	import { toast } from '$lib/toast.svelte';

	type Passkey = { id: string; name?: string | null; createdAt: Date | string; deviceType: string };

	let supported = $state(true);
	let passkeys = $state<Passkey[] | null>(null);
	let busy = $state(false);
	let error = $state<string | null>(null);
	let stale = $state(false);

	async function refresh() {
		const { data, error: err } = await authClient.passkey.listUserPasskeys();
		if (err) {
			error = err.message ?? "Couldn't load your passkeys.";
			passkeys = [];
			return;
		}
		passkeys = (data ?? []) as Passkey[];
	}

	onMount(() => {
		supported = passkeysSupported();
		void refresh();
	});

	async function add() {
		busy = true;
		error = null;
		stale = false;
		const res = await addPasskey();
		busy = false;
		if (res.ok) {
			toast('Passkey added. Next time, sign in with one tap.');
			await refresh();
		} else if (!res.cancelled) {
			error = res.message;
			stale = res.stale;
		}
	}

	async function remove(p: Passkey) {
		if (!confirm(`Remove the passkey "${p.name || 'Passkey'}"? Also delete it from that device's password manager.`)) return;
		const { error: err } = await authClient.passkey.deletePasskey({ id: p.id });
		if (err) {
			error = err.message ?? "Couldn't remove the passkey.";
			return;
		}
		toast('Passkey removed.');
		await refresh();
	}
</script>

<section class="box relative mt-2 mb-6 p-4 sm:p-5 md:mb-8">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="label text-muted">sign-in</p>
			<h2 class="display mt-1.5 text-2xl md:text-3xl">Passkeys</h2>
			<p class="mt-2 max-w-prose text-sm text-muted">
				Sign in with Face ID, Touch ID, your fingerprint or device PIN instead of waiting for an email.
			</p>
		</div>
		{#if supported}
			<button class="btn btn-ink shrink-0" onclick={add} disabled={busy}>{busy ? 'Waiting…' : '+ Add passkey'}</button>
		{/if}
	</div>

	{#if !supported}
		<p class="mt-4 text-sm font-semibold">This browser doesn't support passkeys.</p>
	{/if}

	{#if error}
		<div class="mt-4 flex flex-wrap items-center gap-3" role="alert">
			<p class="text-sm font-semibold text-danger">{error}</p>
			{#if stale}<button class="btn" onclick={signOut}>Sign out</button>{/if}
		</div>
	{/if}

	{#if passkeys === null}
		<p class="mt-4 font-mono text-sm text-muted">Loading…</p>
	{:else if passkeys.length > 0}
		<ul class="mt-4 divide-y-2 divide-line border-2 border-ink bg-card">
			{#each passkeys as p (p.id)}
				<li class="flex items-center gap-3 px-3 py-2.5">
					<div class="min-w-0 flex-1">
						<p class="truncate font-semibold">{p.name || 'Passkey'}</p>
						<p class="font-mono text-xs text-muted">
							added {timeAgo(new Date(p.createdAt).getTime())}{p.deviceType === 'multiDevice' ? ' · synced' : ''}
						</p>
					</div>
					<button class="btn btn-danger px-3 py-1 text-sm" onclick={() => remove(p)}>Remove</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>
