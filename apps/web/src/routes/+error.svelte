<script lang="ts">
	import { page } from '$app/state';
</script>

<svelte:head><title>{page.status} · picslop</title></svelte:head>

<div class="mx-auto grid min-h-[70svh] max-w-xl place-items-center px-4 text-center">
	<div>
		<p class="display text-[7rem] text-accent md:text-[10rem]" style="-webkit-text-stroke: 3px var(--color-ink)">{page.status}</p>
		<p class="mt-4 text-lg font-semibold">{page.error?.message ?? 'Something broke.'}</p>
		<a href="/" class="btn btn-ink mt-8">Back to the board</a>
	</div>
</div>
