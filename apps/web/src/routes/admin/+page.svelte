<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import BarChart from '$lib/components/BarChart.svelte';
	import { compact, timeAgo } from '$lib/format';

	let { data } = $props();
	const s = $derived(data.stats);

	const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : '—');
	function runtime(sec: number) {
		const m = Math.round(sec / 60);
		return m < 60 ? `${m} min` : `${Math.floor(m / 60)}h ${m % 60}m`;
	}
	const shortDay = (iso: string) =>
		new Date(`${iso}T00:00:00Z`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });

	const daily = $derived(
		s.daily.map((d) => ({ label: shortDay(d.day), value: d.posts, detail: d.picked ? `${d.picked} picked` : undefined }))
	);
	const weekly = $derived(s.weeklySignups.map((w) => ({ label: `wk of ${shortDay(w.week)}`, value: w.users })));
	const last30 = $derived(s.daily.reduce((n, d) => n + d.posts, 0));
	const signups12w = $derived(s.weeklySignups.reduce((n, w) => n + w.users, 0));

	const tiles = $derived([
		{ k: 'posts', v: s.all.posts, sub: `${s.all.images} img · ${s.all.videos} vid` },
		{ k: 'members', v: s.users.total, sub: `${s.users.uploaders} have posted` },
		{ k: 'picked', v: s.picked.posts, sub: `${pct(s.picked.posts, s.all.posts)} of posts` },
		{ k: 'votes', v: s.all.up + s.all.down, sub: `${compact(s.all.up)} up · ${compact(s.all.down)} down` },
		{ k: 'comments', v: s.all.comments, sub: s.all.posts ? `${(s.all.comments / s.all.posts).toFixed(1)} per post` : '—' },
		{ k: 'reactions', v: s.all.reactions, sub: s.topReactions[0] ? `mostly ${s.topReactions[0].emoji}` : '—' }
	]);

	const boards = $derived([
		{ id: 'all', name: 'All posts', b: s.all },
		{ id: 'picked', name: '★ Picked', b: s.picked }
	] as const);

	let refreshing = $state(false);
	async function refresh() {
		refreshing = true;
		await invalidateAll();
		refreshing = false;
	}
</script>

<svelte:head><title>Admin · picslop</title></svelte:head>

<div class="mb-4 flex items-center justify-between gap-3">
	<p class="label text-muted">Computed {timeAgo(s.generatedAt)} from every post</p>
	<button class="btn px-3 py-1.5 text-xs" onclick={refresh} disabled={refreshing}>{refreshing ? 'Counting…' : 'Refresh'}</button>
</div>

<!-- Headline numbers -->
<section class="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
	{#each tiles as t (t.k)}
		<div class="box p-3 md:p-4">
			<p class="label text-muted">{t.k}</p>
			<p class="display mt-2 text-3xl md:text-4xl" title={String(t.v)}>{compact(t.v)}</p>
			<p class="mt-1.5 truncate font-mono text-xs text-muted">{t.sub}</p>
		</div>
	{/each}
</section>

<!-- Activity -->
<section class="mt-6 grid gap-4 md:mt-8 lg:grid-cols-2">
	<div class="box p-4 md:p-5">
		<div class="mb-5 flex items-baseline justify-between gap-2">
			<h2 class="display text-xl md:text-2xl">Uploads per day</h2>
			<p class="font-mono text-xs text-muted"><b class="text-ink">{last30}</b> in 30 days</p>
		</div>
		<BarChart bars={daily} unit="uploads" />
	</div>
	<div class="box p-4 md:p-5">
		<div class="mb-5 flex items-baseline justify-between gap-2">
			<h2 class="display text-xl md:text-2xl">New members per week</h2>
			<p class="font-mono text-xs text-muted"><b class="text-ink">{signups12w}</b> in 12 weeks</p>
		</div>
		<BarChart bars={weekly} unit="sign-ups" color="var(--color-ink)" />
	</div>
</section>

<!-- Collections side by side, with their exports -->
<section class="mt-6 md:mt-8">
	<h2 class="display mb-3 text-2xl md:text-3xl">Collections</h2>
	<div class="grid gap-4 lg:grid-cols-2">
		{#each boards as { id, name, b } (id)}
			<div class="box p-4 md:p-5">
				<div class="flex flex-wrap items-start justify-between gap-3">
					<div>
						<h3 class="display text-xl md:text-2xl">{name}</h3>
						<p class="mt-1 font-mono text-xs text-muted">{b.posts} posts from {b.authors} {b.authors === 1 ? 'member' : 'members'}</p>
					</div>
					<a class="btn {id === 'all' ? 'btn-ink' : ''} px-3 py-1.5 text-xs" href="/api/admin/export?scope={id}" data-sveltekit-reload>
						Export zip
					</a>
				</div>
				<dl class="mt-4 grid grid-cols-2 gap-x-6 gap-y-2 font-mono text-sm sm:grid-cols-3">
					<div><dt class="label text-muted">images</dt><dd>{b.images}</dd></div>
					<div><dt class="label text-muted">videos</dt><dd>{b.videos}</dd></div>
					<div><dt class="label text-muted">runtime</dt><dd>{runtime(b.videoSeconds)}</dd></div>
					<div><dt class="label text-muted">upvotes</dt><dd>{b.up}</dd></div>
					<div><dt class="label text-muted">downvotes</dt><dd>{b.down}</dd></div>
					<div><dt class="label text-muted">avg score</dt><dd>{b.posts ? ((b.up - b.down) / b.posts).toFixed(1) : '—'}</dd></div>
					<div><dt class="label text-muted">comments</dt><dd>{b.comments}</dd></div>
					<div><dt class="label text-muted">reactions</dt><dd>{b.reactions}</dd></div>
					<div><dt class="label text-muted">upvote ratio</dt><dd>{pct(b.up, b.up + b.down)}</dd></div>
				</dl>
				{#if id === 'picked'}
					<div class="mt-4 border-t-2 border-dashed border-line pt-3">
						<p class="label text-muted">picks by curator</p>
						{#if s.picked.pickers.length === 0}
							<p class="mt-1 text-sm text-muted">Nothing picked yet.</p>
						{:else}
							<ul class="mt-2 flex flex-wrap gap-2">
								{#each s.picked.pickers as p (p.name)}
									<li class="border-2 border-ink bg-lime px-2 py-0.5 font-mono text-xs">@{p.name} <b>{p.count}</b></li>
								{/each}
							</ul>
						{/if}
					</div>
				{/if}
			</div>
		{/each}
	</div>
	<p class="mt-2 text-xs text-muted">
		Exports contain every full-size file plus <span class="font-mono">posts.json</span> (captions, authors, votes, reactions,
		comments, picks). Large boards take a while to stream.
	</p>
</section>

<!-- Leaderboards -->
<section class="mt-6 grid gap-4 md:mt-8 lg:grid-cols-[2fr_1fr]">
	<div class="box p-4 md:p-5">
		<h2 class="display mb-4 text-xl md:text-2xl">Top posts</h2>
		{#if s.topPosts.length === 0}
			<p class="text-sm text-muted">No posts yet.</p>
		{:else}
			<ol class="grid grid-cols-2 gap-3 sm:grid-cols-4">
				{#each s.topPosts as p, i (p.id)}
					<li>
						<a href="/p/{p.id}" class="group block">
							<div class="relative aspect-square overflow-hidden border-2 border-ink bg-paper-2">
								<img src={p.thumbUrl} alt={p.caption || `Post by @${p.authorName}`} class="h-full w-full object-cover transition-transform group-hover:scale-105" loading="lazy" />
								<span class="label absolute top-0 left-0 bg-ink px-1.5 py-0.5 text-paper">#{i + 1}</span>
								{#if p.picked}<span class="label absolute top-0 right-0 bg-lime px-1.5 py-0.5">★</span>{/if}
							</div>
							<p class="mt-1 truncate font-mono text-xs"><b>{p.score}</b> pts · {p.comments} 💬</p>
							<p class="truncate text-xs text-muted">@{p.authorName}</p>
						</a>
					</li>
				{/each}
			</ol>
		{/if}
	</div>

	<div class="flex flex-col gap-4">
		<div class="box p-4 md:p-5">
			<div class="mb-3 flex items-baseline justify-between">
				<h2 class="display text-xl md:text-2xl">Top uploaders</h2>
				<a href="/admin/users" class="label text-muted underline">all users</a>
			</div>
			<ol class="flex flex-col gap-1.5">
				{#each s.topUploaders as u, i (u.id)}
					<li class="flex items-baseline gap-2 font-mono text-sm">
						<span class="w-5 text-muted">{i + 1}</span>
						<a href="/u/{u.id}" class="min-w-0 flex-1 truncate hover:underline">@{u.name}</a>
						<span>{u.posts}</span><span class="w-14 text-right text-muted">{u.points} pts</span>
					</li>
				{:else}
					<li class="text-sm text-muted">Nobody has posted yet.</li>
				{/each}
			</ol>
		</div>

		<div class="box p-4 md:p-5">
			<h2 class="display mb-3 text-xl md:text-2xl">Reactions</h2>
			<ul class="flex flex-wrap gap-2">
				{#each s.topReactions as r (r.emoji)}
					<li class="border-2 border-ink bg-card px-2 py-1 font-mono text-sm"><span class="text-lg">{r.emoji}</span> {compact(r.count)}</li>
				{:else}
					<li class="text-sm text-muted">No reactions yet.</li>
				{/each}
			</ul>
		</div>

		<div class="box p-4 md:p-5">
			<h2 class="display mb-3 text-xl md:text-2xl">Members</h2>
			<dl class="grid grid-cols-2 gap-y-2 font-mono text-sm">
				<dt class="text-muted">admins</dt><dd class="text-right">{s.users.admins}</dd>
				<dt class="text-muted">curators</dt><dd class="text-right">{s.users.curators}</dd>
				<dt class="text-muted">banned</dt><dd class="text-right">{s.users.banned}</dd>
				<dt class="text-muted">posted this week</dt><dd class="text-right">{s.users.activeLast7d}</dd>
				<dt class="text-muted">never posted</dt><dd class="text-right">{s.users.total - s.users.uploaders}</dd>
			</dl>
		</div>
	</div>
</section>
