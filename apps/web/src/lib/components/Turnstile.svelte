<script lang="ts" module>
	type TurnstileApi = {
		render: (el: HTMLElement, opts: Record<string, unknown>) => string;
		reset: (id: string) => void;
		remove: (id: string) => void;
	};
	declare global {
		interface Window {
			turnstile?: TurnstileApi;
		}
	}

	let loader: Promise<TurnstileApi> | null = null;
	function loadTurnstile(): Promise<TurnstileApi> {
		if (window.turnstile) return Promise.resolve(window.turnstile);
		loader ??= new Promise((resolve, reject) => {
			const s = document.createElement('script');
			s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
			s.async = true;
			s.onload = () => (window.turnstile ? resolve(window.turnstile) : reject(new Error('Turnstile missing')));
			s.onerror = () => {
				loader = null;
				reject(new Error('Could not load the human check.'));
			};
			document.head.appendChild(s);
		});
		return loader;
	}
</script>

<script lang="ts">
	import { onMount } from 'svelte';

	let {
		siteKey,
		action,
		token = $bindable('')
	}: { siteKey: string; action?: string; token?: string } = $props();

	let el: HTMLDivElement;
	let widgetId: string | undefined;
	let failed = $state(false);

	export function reset() {
		token = '';
		if (widgetId && window.turnstile) window.turnstile.reset(widgetId);
	}

	onMount(() => {
		let cancelled = false;
		loadTurnstile()
			.then((ts) => {
				if (cancelled) return;
				widgetId = ts.render(el, {
					sitekey: siteKey,
					action,
					theme: 'light',
					size: 'flexible',
					callback: (t: string) => (token = t),
					'expired-callback': () => (token = ''),
					'error-callback': () => {
						token = '';
					}
				});
			})
			.catch(() => (failed = true));
		return () => {
			cancelled = true;
			if (widgetId && window.turnstile) window.turnstile.remove(widgetId);
		};
	});
</script>

<div bind:this={el} class="min-h-[65px]"></div>
{#if failed}
	<p class="label text-danger">Couldn't load the human check. Disable blockers and reload.</p>
{/if}
