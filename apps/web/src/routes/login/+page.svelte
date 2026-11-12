<script lang="ts">
	import { onMount } from 'svelte';
	import { goto } from '$app/navigation';
	import { authClient, passkeysSupported } from '$lib/auth-client';
	import Turnstile from '$lib/components/Turnstile.svelte';
	import { errorCode, wasCancelled } from '$lib/passkeys';

	let { data } = $props();

	/** What the user types: normally just the part before the @. */
	let local = $state('');
	const domain = $derived(data.domainHint);

	// A full address still works (e.g. allow-listed people outside the school domain).
	const address = $derived.by(() => {
		const v = local.trim().toLowerCase();
		if (!v) return '';
		return v.includes('@') || !domain ? v : `${v}@${domain}`;
	});

	/** Pasting or autofilling "name@school" leaves just "name" in the box. */
	function onLocalInput() {
		if (domain && local.toLowerCase().trim().endsWith(`@${domain}`)) {
			local = local.trim().slice(0, -(domain.length + 1));
		}
	}
	let token = $state('');
	let sending = $state(false);
	let sentTo = $state<string | null>(null);
	let error = $state<string | null>(null);
	let cooldown = $state(0);
	let widget = $state<ReturnType<typeof Turnstile>>();

	const linkErrors: Record<string, string> = {
		INVALID_TOKEN: 'That sign-in link has expired or was already used. Request a new one.',
		EXPIRED_TOKEN: 'That sign-in link has expired. Request a new one.',
		new_user_signup_disabled: 'This email address is not allowed to sign in.'
	};
	const linkError = $derived(
		data.error ? (linkErrors[data.error] ?? 'Sign-in failed. Please request a new link.') : null
	);

	let canPasskey = $state(false);
	let passkeyBusy = $state(false);

	onMount(() => {
		canPasskey = passkeysSupported();
		armAutofill();
	});

	/** Conditional UI: saved passkeys show up in the email field's autofill suggestions. */
	async function armAutofill() {
		if (!passkeysSupported()) return;
		if (!(await PublicKeyCredential.isConditionalMediationAvailable?.().catch(() => false))) return;
		void signInWithPasskey(true);
	}

	async function signInWithPasskey(autoFill = false) {
		if (!autoFill) {
			passkeyBusy = true;
			error = null;
		}
		const { error: err } = await authClient.signIn.passkey({ autoFill });
		if (!autoFill) passkeyBusy = false;
		if (!err) {
			// The login page's load sees the new session and forwards to `next`.
			await goto(data.next, { invalidateAll: true, replaceState: true });
			return;
		}
		if (wasCancelled(err)) {
			// The explicit button aborts the autofill request; put autofill back once it's done.
			if (!autoFill) armAutofill();
			return;
		}
		error =
			errorCode(err) === 'PASSKEY_NOT_FOUND'
				? "That passkey isn't linked to an account here anymore. Use an email link instead."
				: (err.message ?? 'Passkey sign-in failed. Use an email link instead.');
		if (autoFill) armAutofill();
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		error = null;
		if (!address.includes('@') || /\s/.test(address) || address.split('@').length !== 2) {
			error = 'Enter the part of your email before the @.';
			return;
		}
		if (address.includes('+')) {
			error = 'Addresses with a "+" can\'t be used. Use your plain school address.';
			return;
		}
		if (!token) {
			error = 'Please wait for the human check to finish.';
			return;
		}
		sending = true;
		const { error: err } = await authClient.signIn.magicLink(
			{ email: address, callbackURL: data.next, errorCallbackURL: '/login' },
			{ headers: { 'x-captcha-response': token } }
		);
		sending = false;
		widget?.reset();
		if (err) {
			error = err.message ?? 'Could not send the link. Try again.';
			return;
		}
		sentTo = address;
		cooldown = 60;
		const t = setInterval(() => {
			cooldown -= 1;
			if (cooldown <= 0) clearInterval(t);
		}, 1000);
	}
</script>

<svelte:head><title>Sign in · picslop</title></svelte:head>

<div class="relative grid min-h-svh overflow-hidden lg:grid-cols-[1.15fr_1fr]">
	<!-- Poster side -->
	<section class="relative flex flex-col justify-between border-b-2 border-ink bg-accent p-5 pt-[max(1.25rem,env(safe-area-inset-top))] md:p-10 lg:border-r-2 lg:border-b-0">
		<p class="label">members-only image board</p>

		<h1 class="display my-5 text-[19vw] leading-[0.8] md:my-10 md:text-[22vw] lg:my-0 lg:text-[11.5vw]" aria-label="picslop">
			<span class="block">Pic</span>
			<span class="block pl-[0.35em] text-card" style="-webkit-text-stroke: 3px var(--color-ink)">slop</span>
		</h1>

		<div class="flex flex-wrap items-end justify-between gap-4">
			<p class="max-w-xs text-base font-semibold leading-snug md:text-lg">
				Post pictures and clips. Vote on everything. Argue in the comments.
			</p>
			<span class="box rotate-3 bg-lime! px-3 py-2 font-mono text-sm font-semibold">
				{data.domainHint ? `@${data.domainHint} only` : 'invite only'}
			</span>
		</div>

		<div class="tape -top-2 right-16 rotate-[8deg]" aria-hidden="true"></div>
	</section>

	<!-- Form side -->
	<section class="flex items-start justify-center p-4 pb-[max(1.5rem,env(safe-area-inset-bottom))] sm:items-center md:p-10">
		<div class="w-full max-w-md" style="animation: rise 480ms cubic-bezier(.2,.8,.2,1) both">
			{#if sentTo}
				<div class="box relative p-5 sm:p-7">
					<div class="tape -top-3 left-8 -rotate-6" aria-hidden="true"></div>
					<p class="label text-muted">check your inbox</p>
					<h2 class="display mt-3 text-4xl">Link sent</h2>
					<p class="mt-4 leading-relaxed">
						We emailed a sign-in link to <strong class="break-all">{sentTo}</strong>. It works once and expires in
						10 minutes.
					</p>
					<button
						class="btn mt-6"
						disabled={cooldown > 0}
						onclick={() => {
							sentTo = null;
						}}
					>
						{cooldown > 0 ? `Try again in ${cooldown}s` : 'Use a different email / resend'}
					</button>
				</div>
			{:else}
				<form class="box relative space-y-5 p-5 sm:p-7" onsubmit={submit}>
					<div class="tape -top-3 left-8 -rotate-6" aria-hidden="true"></div>
					<div>
						<p class="label text-muted">sign in</p>
						<h2 class="display mt-3 text-4xl">Get a magic link</h2>
					</div>

					{#if linkError}
						<p class="border-2 border-ink bg-lime px-3 py-2 text-sm font-semibold" role="alert">{linkError}</p>
					{/if}

					<label class="block space-y-2">
						<span class="label">School email</span>
						<span class="field flex items-stretch p-0! focus-within:shadow-hard">
							<input
								class="min-w-0 flex-1 bg-transparent px-3 py-2.5 outline-none"
								type="text"
								name="email"
								autocomplete="username webauthn"
								inputmode="email"
								autocapitalize="none"
								autocorrect="off"
								spellcheck="false"
								enterkeyhint="send"
								required
								placeholder={domain ? 'you' : 'you@school.edu'}
								aria-describedby={domain ? 'email-domain' : undefined}
								bind:value={local}
								oninput={onLocalInput}
							/>
							{#if domain && !local.includes('@')}
								<span
									id="email-domain"
									class="flex shrink-0 items-center border-l-2 border-ink bg-paper-2 px-3 font-mono text-[0.9rem] text-muted select-none"
								>
									@{domain}
								</span>
							{/if}
						</span>
					</label>

					<Turnstile bind:this={widget} siteKey={data.turnstileSiteKey} action="login" bind:token />

					{#if error}
						<p class="text-sm font-semibold text-danger" role="alert">{error}</p>
					{/if}

					<button class="btn btn-ink w-full py-3 text-base" disabled={sending || !local.trim()}>
						{sending ? 'Sending…' : 'Email me a link →'}
					</button>

					{#if canPasskey}
						<div class="flex items-center gap-3" aria-hidden="true">
							<span class="h-[2px] flex-1 bg-line"></span>
							<span class="label text-muted">or</span>
							<span class="h-[2px] flex-1 bg-line"></span>
						</div>
						<button
							type="button"
							class="btn w-full py-3 text-base"
							onclick={() => signInWithPasskey()}
							disabled={passkeyBusy}
						>
							{passkeyBusy ? 'Waiting for passkey…' : 'Sign in with a passkey'}
						</button>
					{/if}

					<p class="text-sm text-muted">
						No passwords. Only approved school addresses can get in. Add a passkey from your profile after signing
						in.
					</p>
				</form>
			{/if}
		</div>
	</section>
</div>
