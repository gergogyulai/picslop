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
		{ id: 'blocked', label: 'Blacklisted' },
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
		blocked: (u) => u.blocked,
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

	// --- Blacklist (block an address from ever signing in) -------------------------------------

	function blacklistUser(u: AdminUser) {
		if (u.blocked) return unblock(u.email);
		const reason = prompt(
			`Blacklist ${u.email}? @${u.name} is signed out everywhere and can never sign in again, by email link or passkey. Their account and posts stay.\n\nReason (optional, only admins see it):`
		);
		if (reason === null) return;
		run(u, () => api('/api/admin/blocklist', { body: { email: u.email, reason } }), `Blacklisted ${u.email}.`);
	}

	let newBlock = $state('');
	let newReason = $state('');
	let adding = $state(false);
	async function addBlock(e: SubmitEvent) {
		e.preventDefault();
		adding = true;
		try {
			await api('/api/admin/blocklist', { body: { email: newBlock, reason: newReason } });
			toast(`Blacklisted ${newBlock.trim().toLowerCase()}.`);
			newBlock = newReason = '';
			await invalidateAll();
		} catch (err) {
			toastError(err);
		} finally {
			adding = false;
		}
	}

	async function unblock(email: string) {
		if (!confirm(`Remove ${email} from the blacklist? They'll be able to sign in again if the allowlist lets them.`)) return;
		try {
			await api('/api/admin/blocklist', { method: 'DELETE', body: { email } });
			toast(`${email} can sign in again.`);
			await invalidateAll();
		} catch (err) {
			toastError(err);
		}
	}

	// --- Delete -----------------------------------------------------------------------------

	let dialog = $state<HTMLDialogElement>();
	let doomed = $state<AdminUser | null>(null);
	let alsoBlock = $state(true);
	let deleteReason = $state('');
	let confirmText = $state('');
	let deleting = $state(false);

	function askDelete(u: AdminUser) {
		doomed = u;
		alsoBlock = true;
		deleteReason = '';
		confirmText = '';
		dialog?.showModal();
	}

	async function doDelete(e: SubmitEvent) {
		e.preventDefault();
		const u = doomed;
		if (!u || confirmText.trim() !== u.name) return;
		deleting = true;
		busy = u.id;
		try {
			const r = await api<{ posts: number; comments: number; votes: number; reactions: number; blacklisted: boolean }>(
				`/api/users/${u.id}`,
				{ method: 'DELETE', body: { blacklist: alsoBlock && !u.blocked, reason: deleteReason } }
			);
			dialog?.close();
			toast(
				`Deleted @${u.name}: ${r.posts} posts, ${r.comments} comments, ${r.votes} votes, ${r.reactions} reactions${r.blacklisted || u.blocked ? ' · blacklisted' : ''}.`
			);
			await invalidateAll();
		} catch (err) {
			toastError(err);
		} finally {
			deleting = false;
			busy = null;
		}
	}

	const accountFor = $derived(new Map(data.users.map((u) => [u.email.toLowerCase(), u])));

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
							{#if u.blocked}<span class="label bg-ink px-1.5 py-1 text-paper">blacklisted</span>{/if}
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
									<button class="btn {u.blocked ? '' : 'btn-danger'} px-2 py-1 text-xs" onclick={() => blacklistUser(u)} disabled={busy === u.id} title="Never let this address sign in">
										{u.blocked ? 'Unblock' : 'Blacklist'}
									</button>
									<button class="btn btn-danger px-2 py-1 text-xs" onclick={() => askDelete(u)} disabled={busy === u.id}>Delete…</button>
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
					{#if u.blocked}<span class="label bg-ink px-1.5 py-0.5 text-paper">blacklisted</span>{/if}
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
						<button class="btn {u.blocked ? '' : 'btn-danger'} px-2.5 py-1.5 text-xs" onclick={() => blacklistUser(u)} disabled={busy === u.id}>
							{u.blocked ? 'Unblock' : 'Blacklist'}
						</button>
						<button class="btn btn-danger px-2.5 py-1.5 text-xs" onclick={() => askDelete(u)} disabled={busy === u.id}>Delete…</button>
					{/if}
				</div>
			{/if}
		</li>
	{:else}
		<li class="py-10 text-center text-muted">No users match.</li>
	{/each}
</ul>

<!-- Blacklist: addresses that can never sign in, with or without an account -->
<section class="box mt-8 p-4 md:p-5">
	<div class="flex flex-wrap items-baseline justify-between gap-2">
		<h2 class="display text-xl md:text-2xl">Blacklist</h2>
		<p class="label text-muted">{data.blocked.length} {data.blocked.length === 1 ? 'address' : 'addresses'}</p>
	</div>
	<p class="mt-2 max-w-prose text-sm text-muted">
		These addresses can't request a sign-in link, can't get an account, and can't sign in with a passkey. Anyone already
		signed in with one is kicked out on their next request. This overrides the allowlist. You can add addresses that haven't signed up yet.
	</p>

	<form class="mt-4 flex flex-col gap-2 md:flex-row" onsubmit={addBlock}>
		<input class="field md:max-w-xs" type="email" required placeholder="someone@example.edu" bind:value={newBlock} aria-label="Email to blacklist" />
		<input class="field md:max-w-sm" type="text" maxlength="200" placeholder="Reason (optional)" bind:value={newReason} aria-label="Reason" />
		<button class="btn btn-ink shrink-0" disabled={adding || !newBlock.trim()}>{adding ? 'Adding…' : 'Blacklist'}</button>
	</form>

	{#if data.blocked.length}
		<ul class="mt-4 divide-y divide-line border-t-2 border-ink">
			{#each data.blocked as b (b.email)}
				{@const acct = accountFor.get(b.email)}
				<li class="flex flex-wrap items-center gap-x-4 gap-y-1 py-2.5">
					<div class="min-w-0 flex-1">
						<p class="truncate font-mono text-sm">{b.email}</p>
						<p class="truncate text-xs text-muted">
							{b.at ? timeAgo(b.at) : ''}{b.by ? ` by @${b.by}` : ''}{b.reason ? ` · “${b.reason}”` : ''}
							{#if acct} · account <a class="underline" href="/u/{acct.id}">@{acct.name}</a>{:else} · no account{/if}
						</p>
					</div>
					<button class="btn px-2.5 py-1 text-xs" onclick={() => unblock(b.email)}>Unblock</button>
				</li>
			{/each}
		</ul>
	{/if}
</section>

<dialog
	bind:this={dialog}
	class="box m-auto w-[min(32rem,calc(100vw-2rem))] p-0 backdrop:bg-ink/50"
	onclose={() => !deleting && (doomed = null)}
	oncancel={(e) => deleting && e.preventDefault()}
>
	{#if doomed}
		<form class="p-5" onsubmit={doDelete}>
			<p class="label text-danger">permanent</p>
			<h2 class="display mt-1.5 text-2xl">Delete @{doomed.name}</h2>
			<p class="mt-1 font-mono text-xs text-muted">{doomed.email}</p>
			<p class="mt-4 text-sm">This removes, with no undo:</p>
			<ul class="mt-1.5 list-disc pl-5 text-sm">
				<li><b>{doomed.posts}</b> {doomed.posts === 1 ? 'post' : 'posts'} with their files{doomed.picked ? `, ${doomed.picked} of them picked` : ''}</li>
				<li>every comment, vote and reaction they left on anyone's post</li>
				<li>their account, sign-in methods ({doomed.passkeys} {doomed.passkeys === 1 ? 'passkey' : 'passkeys'}), roles and sessions</li>
			</ul>

			<label class="mt-4 flex items-start gap-2.5 border-2 border-ink bg-paper-2 p-3 text-sm">
				<input type="checkbox" class="mt-0.5 h-4 w-4 accent-[var(--color-ink)]" checked={alsoBlock || doomed.blocked} onchange={(e) => (alsoBlock = e.currentTarget.checked)} disabled={doomed.blocked} />
				<span>
					<b>Blacklist {doomed.email}</b>
					<span class="block text-muted">
						{doomed.blocked
							? 'Already blacklisted; it stays that way.'
							: 'Without this they can sign up again with a fresh, empty account if the allowlist lets them.'}
					</span>
				</span>
			</label>
			{#if alsoBlock && !doomed.blocked}
				<input class="field mt-2" type="text" maxlength="200" placeholder="Reason (optional)" bind:value={deleteReason} />
			{/if}

			<label class="mt-4 block text-sm">
				Type <b class="font-mono">{doomed.name}</b> to confirm
				<input class="field mt-1.5" autocomplete="off" spellcheck="false" bind:value={confirmText} disabled={deleting} />
			</label>

			<div class="mt-5 flex justify-end gap-2">
				<button type="button" class="btn" onclick={() => dialog?.close()} disabled={deleting}>Cancel</button>
				<button class="btn btn-danger" disabled={deleting || confirmText.trim() !== doomed.name}>
					{deleting ? 'Deleting… this can take a minute' : 'Delete forever'}
				</button>
			</div>
		</form>
	{/if}
</dialog>
