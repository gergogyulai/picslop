<script lang="ts">
	import { invalidateAll } from '$app/navigation';
	import { api } from '$lib/api';
	import { timeAgo } from '$lib/format';
	import type { AdminUser, Role } from '$lib/server/admin';
	import { toast, toastError } from '$lib/toast.svelte';

	let { data } = $props();

	const FILTERS = [
		{ id: 'all', label: 'All' },
		{ id: 'staff', label: 'Admins' },
		{ id: 'curator', label: 'Curators' },
		{ id: 'banned', label: 'Banned' },
		{ id: 'lurkers', label: 'Never posted' }
	] as const;
	const SORTS = [
		{ id: 'joined', label: 'Newest' },
		{ id: 'seen', label: 'Last seen' },
		{ id: 'posts', label: 'Most posts' },
		{ id: 'points', label: 'Most points' },
		{ id: 'name', label: 'Name' }
	] as const;

	let q = $state('');
	let filter = $state<(typeof FILTERS)[number]['id']>('all');
	let sort = $state<(typeof SORTS)[number]['id']>('joined');
	let busy = $state<string | null>(null);

	const match: Record<typeof filter, (u: AdminUser) => boolean> = {
		all: () => true,
		staff: (u) => u.role === 'owner' || u.role === 'admin',
		curator: (u) => u.role === 'curator',
		banned: (u) => u.banned,
		lurkers: (u) => u.posts === 0
	};
	const by: Record<typeof sort, (a: AdminUser, b: AdminUser) => number> = {
		joined: (a, b) => b.joinedAt - a.joinedAt,
		seen: (a, b) => b.lastSeenAt - a.lastSeenAt,
		posts: (a, b) => b.posts - a.posts || b.points - a.points,
		points: (a, b) => b.points - a.points,
		name: (a, b) => a.name.localeCompare(b.name)
	};

	const counts = $derived(Object.fromEntries(FILTERS.map((f) => [f.id, data.users.filter(match[f.id]).length])));
	const shown = $derived.by(() => {
		const needle = q.trim().toLowerCase();
		return data.users
			.filter(match[filter])
			.filter((u) => !needle || u.name.toLowerCase().includes(needle) || u.email.toLowerCase().includes(needle))
			.sort(by[sort]);
	});

	const ROLE_LABEL: Record<Role, string> = { owner: 'Owner', admin: 'Admin', curator: 'Curator', member: 'Member' };
	const ROLE_STYLE: Record<Role, string> = {
		owner: 'bg-ink text-paper',
		admin: 'bg-accent',
		curator: 'bg-lime',
		member: 'bg-card text-muted'
	};

	async function run(u: AdminUser, fn: () => Promise<unknown>, done: string) {
		busy = u.id;
		try {
			await fn();
			toast(done);
			await invalidateAll();
		} catch (e) {
			toastError(e);
		} finally {
			busy = null;
		}
	}

	function setRole(u: AdminUser, select: HTMLSelectElement) {
		const role = select.value;
		if (role === u.role) return;
		if (role === 'admin' && !confirm(`Make @${u.name} an admin? They'll be able to manage every other user.`)) {
			select.value = u.role;
			return;
		}
		run(u, () => api(`/api/users/${u.id}/role`, { body: { role } }), `@${u.name} is now ${role === 'member' ? 'a member' : `a ${role}`}.`);
	}

	function toggleBan(u: AdminUser) {
		if (u.banned) return run(u, () => api(`/api/users/${u.id}/ban`, { body: { banned: false } }), `Unbanned @${u.name}.`);
		if (!confirm(`Ban @${u.name}? They can still browse, but can't post, vote, react or comment.`)) return;
		const signOut = confirm(`Also sign @${u.name} out on every device?`);
		run(u, () => api(`/api/users/${u.id}/ban`, { body: { banned: true, signOut } }), `Banned @${u.name}.`);
	}

	function signOutEverywhere(u: AdminUser) {
		if (!confirm(`Sign @${u.name} out on every device? They'll need a new email link or their passkey to get back in.`)) return;
		run(u, () => api(`/api/users/${u.id}/sessions`, { method: 'DELETE' }), `Signed @${u.name} out everywhere.`);
	}

	const editable = (u: AdminUser) => u.role !== 'owner' && u.id !== data.meId;
	const ago = (t: number) => (t ? timeAgo(t) : '—');
</script>

<svelte:head><title>Users · Admin · picslop</title></svelte:head>

<div class="flex flex-col gap-3 md:flex-row md:items-center">
	<input class="field md:max-w-xs" type="search" placeholder="Search name or email" bind:value={q} aria-label="Search users" />
	<div class="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 [scrollbar-width:none] md:mx-0 md:flex-wrap md:px-0">
		{#each FILTERS as f (f.id)}
			<button class="btn shrink-0 px-3 py-1.5 text-xs whitespace-nowrap {filter === f.id ? 'btn-ink' : ''}" onclick={() => (filter = f.id)} aria-pressed={filter === f.id}>
				{f.label} <span class="font-mono opacity-70">{counts[f.id]}</span>
			</button>
		{/each}
	</div>
	<label class="label flex items-center gap-2 text-muted md:ml-auto">
		sort
		<select class="border-2 border-ink bg-card px-2 py-1.5 font-mono text-xs text-ink normal-case" bind:value={sort}>
			{#each SORTS as s (s.id)}<option value={s.id}>{s.label}</option>{/each}
		</select>
	</label>
</div>

<p class="label mt-4 mb-2 text-muted">{shown.length} of {data.users.length} users</p>

<!-- Desktop: table -->
<div class="box hidden overflow-x-auto md:block">
	<table class="w-full text-left text-sm">
		<thead class="label border-b-2 border-ink text-muted">
			<tr>
				<th class="px-3 py-2.5 font-normal">User</th>
				<th class="px-3 py-2.5 font-normal">Role</th>
				<th class="px-3 py-2.5 text-right font-normal">Posts</th>
				<th class="px-3 py-2.5 text-right font-normal">Points</th>
				<th class="px-3 py-2.5 text-right font-normal">Picked</th>
				<th class="px-3 py-2.5 font-normal">Joined</th>
				<th class="px-3 py-2.5 font-normal">Last seen</th>
				<th class="px-3 py-2.5 text-right font-normal">Actions</th>
			</tr>
		</thead>
		<tbody>
			{#each shown as u (u.id)}
				<tr class="border-b border-line last:border-0 {u.banned ? 'bg-accent/10' : ''} {busy === u.id ? 'opacity-50' : ''}">
					<td class="max-w-[260px] px-3 py-2.5">
						<a href="/u/{u.id}" class="block truncate font-bold hover:underline">@{u.name}</a>
						<span class="block truncate font-mono text-xs text-muted" title={u.email}>{u.email}</span>
					</td>
					<td class="px-3 py-2.5">
						<div class="flex flex-wrap items-center gap-1.5">
							{#if editable(u)}
								<select
									class="border-2 border-ink px-1.5 py-1 font-mono text-xs {ROLE_STYLE[u.role]}"
									value={u.role}
									disabled={busy === u.id}
									onchange={(e) => setRole(u, e.currentTarget)}
									aria-label="Role for @{u.name}"
								>
									<option value="member">Member</option>
									<option value="curator">Curator</option>
									<option value="admin">Admin</option>
								</select>
							{:else}
								<span class="label border-2 border-ink px-1.5 py-1 {ROLE_STYLE[u.role]}" title={u.role === 'owner' ? 'Set in ADMIN_EMAILS' : 'You'}>
									{ROLE_LABEL[u.role]}{u.id === data.meId ? ' · you' : ''}
								</span>
							{/if}
							{#if u.banned}<span class="label bg-accent px-1.5 py-1">banned</span>{/if}
							{#if u.passkeys}<span class="label text-muted" title="{u.passkeys} passkey{u.passkeys === 1 ? '' : 's'}">🔑{u.passkeys}</span>{/if}
						</div>
					</td>
					<td class="px-3 py-2.5 text-right font-mono">{u.posts}</td>
					<td class="px-3 py-2.5 text-right font-mono">{u.points}</td>
					<td class="px-3 py-2.5 text-right font-mono">{u.picked || '—'}</td>
					<td class="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-muted">{ago(u.joinedAt)}</td>
					<td class="px-3 py-2.5 font-mono text-xs whitespace-nowrap text-muted">{ago(u.lastSeenAt)}</td>
					<td class="px-3 py-2.5">
						{#if editable(u)}
							<div class="flex justify-end gap-1.5">
								<button class="btn px-2 py-1 text-xs" onclick={() => signOutEverywhere(u)} disabled={busy === u.id} title="Sign out on every device">Sign out</button>
								{#if u.role !== 'admin'}
									<button class="btn {u.banned ? '' : 'btn-danger'} px-2 py-1 text-xs" onclick={() => toggleBan(u)} disabled={busy === u.id}>
										{u.banned ? 'Unban' : 'Ban'}
									</button>
								{/if}
							</div>
						{/if}
					</td>
				</tr>
			{:else}
				<tr><td colspan="8" class="px-3 py-10 text-center text-muted">No users match.</td></tr>
			{/each}
		</tbody>
	</table>
</div>

<!-- Phones: cards -->
<ul class="flex flex-col gap-3 md:hidden">
	{#each shown as u (u.id)}
		<li class="box p-3 {u.banned ? 'bg-accent/10' : ''} {busy === u.id ? 'opacity-50' : ''}">
			<div class="flex items-start justify-between gap-2">
				<div class="min-w-0">
					<a href="/u/{u.id}" class="block truncate font-bold">@{u.name}</a>
					<span class="block truncate font-mono text-xs text-muted">{u.email}</span>
				</div>
				<div class="flex shrink-0 gap-1">
					{#if u.banned}<span class="label bg-accent px-1.5 py-0.5">banned</span>{/if}
					{#if !editable(u)}<span class="label border-2 border-ink px-1.5 py-0.5 {ROLE_STYLE[u.role]}">{ROLE_LABEL[u.role]}</span>{/if}
				</div>
			</div>
			<p class="mt-2 font-mono text-xs text-muted">
				<b class="text-ink">{u.posts}</b> posts · <b class="text-ink">{u.points}</b> pts · joined {ago(u.joinedAt)} · seen {ago(u.lastSeenAt)}
			</p>
			{#if editable(u)}
				<div class="mt-3 flex flex-wrap gap-2">
					<select
						class="border-2 border-ink px-2 py-1.5 font-mono text-xs {ROLE_STYLE[u.role]}"
						value={u.role}
						disabled={busy === u.id}
						onchange={(e) => setRole(u, e.currentTarget)}
						aria-label="Role for @{u.name}"
					>
						<option value="member">Member</option>
						<option value="curator">Curator</option>
						<option value="admin">Admin</option>
					</select>
					<button class="btn px-2.5 py-1.5 text-xs" onclick={() => signOutEverywhere(u)} disabled={busy === u.id}>Sign out</button>
					{#if u.role !== 'admin'}
						<button class="btn {u.banned ? '' : 'btn-danger'} px-2.5 py-1.5 text-xs" onclick={() => toggleBan(u)} disabled={busy === u.id}>
							{u.banned ? 'Unban' : 'Ban'}
						</button>
					{/if}
				</div>
			{/if}
		</li>
	{:else}
		<li class="py-10 text-center text-muted">No users match.</li>
	{/each}
</ul>
