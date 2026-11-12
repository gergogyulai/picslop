<script lang="ts">
	import { onMount } from 'svelte';
	import { authClient, passkeysSupported } from '$lib/auth-client';
	import { addPasskey, dismissNudge, nudgeDismissed } from '$lib/passkeys';
	import { toast } from '$lib/toast.svelte';

	let show = $state(false);
	let busy = $state(false);
	let error = $state<string | null>(null);

	onMount(async () => {
		if (!passkeysSupported() || nudgeDismissed()) return;
		// Only offer it on devices that can do Face ID / Touch ID / Windows Hello etc. without a security key.
		const platform = await PublicKeyCredential.isUserVerifyingPlatformAuthenticatorAvailable?.().catch(() => false);
		if (!platform) return;
		const { data } = await authClient.passkey.listUserPasskeys();
		if (!data) return;
		if (data.length > 0) {
			dismissNudge();
			return;
		}
		show = true;
	});

	async function add() {
		busy = true;
		error = null;
		const res = await addPasskey();
		busy = false;
		if (res.ok) {
			show = false;
			toast('Passkey added. Next time, sign in with one tap.');
		} else if (!res.cancelled) {
			error = res.message;
		}
	}

	function later() {
		dismissNudge();
		show = false;
	}
</script>

{#if show}
	<div class="mx-auto max-w-[1400px] px-4 pt-4 md:px-6">
		<div class="box flex flex-col gap-3 bg-lime! p-4 sm:flex-row sm:items-center" role="region" aria-label="Set up a passkey">
			<div class="min-w-0 flex-1">
				<p class="font-semibold">Skip the email next time</p>
				<p class="text-sm">Add a passkey and sign in on this device with Face ID, Touch ID or your PIN.</p>
				{#if error}<p class="mt-1 text-sm font-semibold text-danger" role="alert">{error}</p>{/if}
			</div>
			<div class="flex shrink-0 gap-2">
				<button class="btn" onclick={later}>Not now</button>
				<button class="btn btn-ink" onclick={add} disabled={busy}>{busy ? 'Waiting…' : 'Add passkey'}</button>
			</div>
		</div>
	</div>
{/if}
