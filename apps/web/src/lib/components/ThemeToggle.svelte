<script lang="ts">
	import { onMount } from 'svelte';
	import { getThemePref, setThemePref, syncThemeColor, type ThemePref } from '$lib/theme';

	let { class: cls = '' }: { class?: string } = $props();

	let pref = $state<ThemePref>('system');
	const order: ThemePref[] = ['system', 'light', 'dark'];
	const labels: Record<ThemePref, string> = { system: 'Theme: system', light: 'Theme: light', dark: 'Theme: dark' };

	onMount(() => {
		pref = getThemePref();
		const mq = matchMedia('(prefers-color-scheme: dark)');
		mq.addEventListener('change', syncThemeColor);
		return () => mq.removeEventListener('change', syncThemeColor);
	});

	function cycle() {
		pref = order[(order.indexOf(pref) + 1) % order.length];
		setThemePref(pref);
	}
</script>

<button class="btn px-3 {cls}" onclick={cycle} title="{labels[pref]} (click to change)" aria-label="{labels[pref]}, click to change">
	{#if pref === 'light'}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="4" /><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4" /></svg>
	{:else if pref === 'dark'}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z" /></svg>
	{:else}
		<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" aria-hidden="true"><circle cx="12" cy="12" r="9" /><path d="M12 3a9 9 0 0 1 0 18z" fill="currentColor" /></svg>
	{/if}
</button>
