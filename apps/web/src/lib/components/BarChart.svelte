<script lang="ts">
	type Bar = { label: string; value: number; detail?: string };

	let {
		bars,
		unit,
		color = 'var(--color-accent)',
		height = 160
	}: { bars: Bar[]; unit: string; color?: string; height?: number } = $props();

	const max = $derived(Math.max(1, ...bars.map((b) => b.value)));
	// A round-ish ceiling so the top gridline reads as a real number.
	const ceil = $derived.by(() => {
		if (max <= 5) return max;
		const mag = 10 ** Math.floor(Math.log10(max));
		const n = max / mag;
		return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * mag;
	});
	let hover = $state<number | null>(null);
	const active = $derived(hover === null ? null : bars[hover]);
</script>

<div class="relative select-none">
	<div class="relative" style="height:{height}px">
		<!-- Recessive gridlines: top (ceiling) and middle -->
		<div class="pointer-events-none absolute inset-x-0 top-0 border-t border-dashed border-line"></div>
		<div class="pointer-events-none absolute inset-x-0 top-1/2 border-t border-dashed border-line"></div>
		<span class="label pointer-events-none absolute -top-2 right-0 bg-card pl-1 text-[0.62rem] text-muted">{ceil}</span>

		<div class="absolute inset-0 flex items-end gap-[2px] border-b-2 border-ink" role="list" onmouseleave={() => (hover = null)}>
			{#each bars as b, i (b.label)}
				<!-- Hit target is the full column, not just the bar -->
				<div
					class="relative flex h-full min-w-0 flex-1 items-end"
					role="listitem"
					aria-label="{b.label}: {b.value} {unit}"
					onmouseenter={() => (hover = i)}
					onfocus={() => (hover = i)}
					tabindex="-1"
				>
					<div
						class="w-full transition-opacity"
						style="height:{(b.value / ceil) * 100}%;min-height:{b.value > 0 ? 2 : 0}px;background:{color};opacity:{hover === null || hover === i ? 1 : 0.45}"
					></div>
				</div>
			{/each}
		</div>

		{#if active && hover !== null}
			<div
				class="box pointer-events-none absolute z-10 -translate-x-1/2 px-2.5 py-1.5 whitespace-nowrap"
				style="left:clamp(60px, {((hover + 0.5) / bars.length) * 100}%, calc(100% - 60px));top:-8px;transform:translate(-50%,-100%)"
			>
				<p class="label text-[0.62rem] text-muted">{active.label}</p>
				<p class="font-mono text-sm"><b>{active.value}</b> {unit}</p>
				{#if active.detail}<p class="font-mono text-xs text-muted">{active.detail}</p>{/if}
			</div>
		{/if}
	</div>
	<div class="label mt-1.5 flex justify-between text-[0.62rem] text-muted">
		<span>{bars[0]?.label}</span>
		<span>{bars.at(-1)?.label}</span>
	</div>
</div>
