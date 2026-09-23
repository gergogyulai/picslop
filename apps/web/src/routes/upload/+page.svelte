<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/state';
	import { api } from '$lib/api';
	import Turnstile from '$lib/components/Turnstile.svelte';
	import {
		ACCEPT_ATTR,
		BULK_MAX_FILES,
		CAPTION_MAX,
		IMAGE_MAX_BYTES,
		VIDEO_MAX_BYTES,
		VIDEO_MAX_SECONDS
	} from '$lib/constants';
	import { formatBytes, formatDuration } from '$lib/format';
	import { isSupportedFile, prepareFile, putWithProgress, type Prepared } from '$lib/media-prep';
	import { toast } from '$lib/toast.svelte';

	let { data } = $props();

	type Status = 'preparing' | 'ready' | 'invalid' | 'uploading' | 'processing' | 'done' | 'failed';
	type Item = {
		key: number;
		source: File;
		name: string;
		status: Status;
		note: string;
		prepared?: Prepared;
		caption: string;
		progress: number;
		postId?: string;
	};

	const CONCURRENCY = 3;
	let seq = 0;
	let items = $state<Item[]>([]);
	let token = $state('');
	let widget = $state<ReturnType<typeof Turnstile>>();
	let error = $state<string | null>(null);
	let busy = $state(false);
	let dragging = $state(false);
	let input = $state<HTMLInputElement>();
	let cameraInput = $state<HTMLInputElement>();

	const active = $derived(items.filter((i) => i.status !== 'done'));
	const sendable = $derived(items.filter((i) => (i.status === 'ready' || i.status === 'failed') && i.prepared));
	const preparing = $derived(items.some((i) => i.status === 'preparing'));
	const doneItems = $derived(items.filter((i) => i.status === 'done'));
	const inFlight = $derived(items.filter((i) => i.status === 'uploading' || i.status === 'processing'));
	const overall = $derived.by(() => {
		const batch = items.filter((i) => ['uploading', 'processing', 'done'].includes(i.status) && i.prepared);
		const total = batch.reduce((s, i) => s + i.prepared!.file.size, 0);
		if (!total) return 0;
		const sent = batch.reduce(
			(s, i) => s + i.prepared!.file.size * (i.status === 'uploading' ? i.progress : 1),
			0
		);
		return sent / total;
	});

	// ---------------------------------------------------------------- adding files

	let prepQueue: Item[] = [];
	let prepRunning = false;

	function addFiles(list: FileList | File[] | null | undefined) {
		if (!list?.length) return;
		error = null;
		const files = [...list];
		const unsupported = files.filter((f) => !isSupportedFile(f));
		const room = BULK_MAX_FILES - active.length;
		const accepted = files.filter(isSupportedFile).slice(0, Math.max(0, room));

		if (unsupported.length) toast(`Skipped ${unsupported.length} unsupported file${unsupported.length > 1 ? 's' : ''}.`, 'error');
		if (files.length - unsupported.length > accepted.length) {
			toast(`Only ${BULK_MAX_FILES} files per upload — the rest were left out.`, 'error');
		}
		for (const f of accepted) {
			const item: Item = { key: ++seq, source: f, name: f.name, status: 'preparing', note: 'Waiting…', caption: '', progress: 0 };
			items.push(item);
			prepQueue.push(items[items.length - 1]!);
		}
		if (input) input.value = '';
		if (cameraInput) cameraInput.value = '';
		runPrepQueue();
	}

	/** One file at a time: HEIC decoding and video probing are heavy on phones. */
	async function runPrepQueue() {
		if (prepRunning) return;
		prepRunning = true;
		while (prepQueue.length) {
			const item = prepQueue.shift()!;
			if (!items.includes(item)) continue; // removed while waiting
			try {
				const prepared = await prepareFile(item.source, (s) => (item.note = s));
				if (!items.includes(item)) {
					URL.revokeObjectURL(prepared.previewUrl);
					continue;
				}
				item.prepared = prepared;
				item.name = prepared.name;
				item.status = 'ready';
				item.note = '';
			} catch (e) {
				item.status = 'invalid';
				item.note = e instanceof Error ? e.message : "Couldn't read that file.";
			}
		}
		prepRunning = false;
	}

	function remove(item: Item) {
		if (item.prepared) URL.revokeObjectURL(item.prepared.previewUrl);
		items = items.filter((i) => i !== item);
	}

	function clearDone() {
		for (const i of doneItems) if (i.prepared) URL.revokeObjectURL(i.prepared.previewUrl);
		items = items.filter((i) => i.status !== 'done');
	}

	function captionToAll(from: Item) {
		for (const i of items) if (i.status !== 'done') i.caption = from.caption;
		toast('Caption copied to every file.');
	}

	// ---------------------------------------------------------------- uploading

	async function uploadOne(item: Item, target: { id: string; uploadUrl: string; posterUrl?: string }) {
		const p = item.prepared!;
		try {
			item.status = 'uploading';
			item.progress = 0;
			item.note = '';
			if (target.posterUrl && p.poster) await putWithProgress(target.posterUrl, p.poster, p.poster.type);
			await putWithProgress(target.uploadUrl, p.file, p.type, (f) => (item.progress = f));
			item.status = 'processing';
			const done = await api<{ id: string }>(`/api/uploads/${target.id}/complete`, { body: {} });
			item.status = 'done';
			item.postId = done.id;
		} catch (e) {
			item.status = 'failed';
			item.note = e instanceof Error ? e.message : 'Upload failed.';
		}
	}

	async function submit(e: SubmitEvent) {
		e.preventDefault();
		if (busy || !sendable.length || preparing) return;
		if (!token) {
			error = 'Please wait for the human check to finish.';
			return;
		}
		error = null;
		busy = true;
		const batch = [...sendable];
		const onlyOne = items.length === 1;

		let targets: { id: string; uploadUrl: string; posterUrl?: string }[];
		try {
			const res = await api<{ uploads: typeof targets }>('/api/uploads', {
				body: {
					turnstile: token,
					items: batch.map((i) => {
						const p = i.prepared!;
						return {
							kind: p.kind,
							type: p.type,
							size: p.file.size,
							caption: i.caption,
							...(p.kind === 'video' && { posterType: p.poster!.type, posterSize: p.poster!.size, duration: p.duration })
						};
					})
				}
			});
			targets = res.uploads;
		} catch (err) {
			error = err instanceof Error ? err.message : 'Upload failed.';
			busy = false;
			widget?.reset();
			return;
		}
		widget?.reset(); // the token is single-use; a retry needs a fresh one

		// Small worker pool so a batch of videos doesn't saturate the connection.
		let next = 0;
		await Promise.all(
			Array.from({ length: Math.min(CONCURRENCY, batch.length) }, async () => {
				while (next < batch.length) {
					const i = next++;
					await uploadOne(batch[i]!, targets[i]!);
				}
			})
		);
		busy = false;

		const failed = batch.filter((i) => i.status === 'failed').length;
		if (onlyOne && !failed && batch[0]?.postId) {
			URL.revokeObjectURL(batch[0].prepared!.previewUrl);
			await goto(`/p/${batch[0].postId}`);
			return;
		}
		if (failed) error = `${failed} of ${batch.length} failed. Fix or remove them, then press Retry.`;
		else toast(`Posted ${batch.length} file${batch.length > 1 ? 's' : ''}.`);
	}

	function beforeUnload(e: BeforeUnloadEvent) {
		if (busy) e.preventDefault();
	}

	const statusLabel: Record<Status, string> = {
		preparing: 'Preparing',
		ready: 'Ready',
		invalid: "Can't upload",
		uploading: 'Uploading',
		processing: 'Processing',
		done: 'Posted',
		failed: 'Failed'
	};
</script>

<svelte:head><title>Upload · picslop</title></svelte:head>
<svelte:window onbeforeunload={beforeUnload} />

<div class="mx-auto max-w-6xl px-4 py-5 md:px-6 md:py-12">
	<p class="label text-muted">new post{items.length > 1 ? 's' : ''}</p>
	<h1 class="display mt-1.5 text-[2.6rem] md:mt-2 md:text-[4.5rem]">Upload</h1>
	<div class="mt-4 mb-5 h-[3px] bg-ink md:mt-5 md:mb-8"></div>

	<form class="grid gap-5 md:gap-8 lg:grid-cols-[1fr_340px]" onsubmit={submit}>
		<div class="space-y-5">
			<!-- Drop zone -->
			<label
				class="group relative flex cursor-pointer flex-col items-center justify-center gap-3 border-2 border-dashed border-ink p-6 text-center transition-colors {items.length
					? 'min-h-32'
					: 'aspect-[4/3] max-sm:aspect-auto max-sm:min-h-56 md:aspect-[16/9]'} {dragging ? 'bg-lime' : 'bg-card hover:bg-paper-2'} {active.length >= BULK_MAX_FILES || busy
					? 'pointer-events-none opacity-50'
					: ''}"
				ondragover={(e) => {
					e.preventDefault();
					dragging = true;
				}}
				ondragleave={() => (dragging = false)}
				ondrop={(e) => {
					e.preventDefault();
					dragging = false;
					addFiles(e.dataTransfer?.files);
				}}
			>
				<input
					bind:this={input}
					type="file"
					multiple
					accept={ACCEPT_ATTR}
					class="sr-only"
					onchange={(e) => addFiles(e.currentTarget.files)}
					disabled={busy || active.length >= BULK_MAX_FILES}
				/>
				{#if items.length}
					<span class="display text-2xl">+ Add more</span>
					<span class="label text-muted">{active.length}/{BULK_MAX_FILES} files</span>
				{:else}
					<span class="display text-5xl transition-transform group-hover:-rotate-3 md:text-6xl pointer-coarse:hidden">Drop them<br />here</span>
					<span class="display text-4xl pointer-fine:hidden">Pick<br />files</span>
					<span class="btn btn-ink pointer-events-none pointer-coarse:hidden">or pick files</span>
					<span class="btn btn-ink pointer-events-none pointer-fine:hidden">Photos & videos</span>
					<span class="label text-muted">up to {BULK_MAX_FILES} at once · each becomes its own post</span>
				{/if}
			</label>

			<!-- Phones: shoot straight from the camera -->
			<div class="flex gap-2 pointer-fine:hidden">
				<label
					class="btn flex-1 py-3 {active.length >= BULK_MAX_FILES || busy ? 'pointer-events-none opacity-50' : ''}"
				>
					<input
						bind:this={cameraInput}
						type="file"
						accept="image/*,video/*"
						capture="environment"
						class="sr-only"
						onchange={(e) => addFiles(e.currentTarget.files)}
						disabled={busy || active.length >= BULK_MAX_FILES}
					/>
					<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" aria-hidden="true"><path d="M3 8h4l2-3h6l2 3h4v12H3z" /><circle cx="12" cy="13.5" r="3.5" /></svg>
					Camera
				</label>
			</div>

			<!-- Queue -->
			{#if items.length}
				<ul class="grid gap-4 sm:grid-cols-2">
					{#each items as item (item.key)}
						{@const p = item.prepared}
						<li
							class="box flex flex-col overflow-hidden {item.status === 'invalid' || item.status === 'failed'
								? 'border-danger!'
								: ''}"
						>
							<div class="relative aspect-[4/3] border-b-2 border-ink bg-paper-2">
								{#if p}
									<img src={p.previewUrl} alt="" class="absolute inset-0 h-full w-full object-cover {item.status === 'done' ? 'opacity-60' : ''}" />
									{#if p.kind === 'video'}
										<span class="label absolute bottom-2 left-2 border-2 border-ink bg-card px-1.5 py-0.5">
											▶ {formatDuration(p.duration ?? 0)}
										</span>
									{/if}
								{:else}
									<div class="absolute inset-0 grid place-items-center p-4 text-center">
										<span class="label {item.status === 'preparing' ? 'animate-pulse' : 'text-danger'}">{item.note}</span>
									</div>
								{/if}

								<span
									class="label absolute top-2 left-2 border-2 border-ink px-1.5 py-0.5 {item.status === 'done'
										? 'bg-lime'
										: item.status === 'failed' || item.status === 'invalid'
											? 'bg-accent'
											: 'bg-card'}"
								>
									{statusLabel[item.status]}
								</span>

								{#if item.status === 'done' && item.postId}
									<a href="/p/{item.postId}" class="btn absolute right-2 bottom-2 px-2.5 py-1">View →</a>
								{:else if !busy || item.status === 'invalid'}
									<button type="button" class="btn absolute top-2 right-2 px-2 py-1" onclick={() => remove(item)} aria-label="Remove {item.name}">✕</button>
								{/if}

								{#if item.status === 'uploading' || item.status === 'processing'}
									<div class="absolute inset-x-0 bottom-0 h-2 bg-card/80">
										<div
											class="h-full bg-accent transition-[width] duration-200 {item.status === 'processing' ? 'animate-pulse' : ''}"
											style="width: {item.status === 'processing' ? 100 : Math.round(item.progress * 100)}%"
										></div>
									</div>
								{/if}
							</div>

							<div class="flex flex-1 flex-col gap-2 p-3">
								<div class="label flex justify-between gap-2 text-muted">
									<span class="truncate normal-case" title={item.name}>{item.name}</span>
									{#if p}<span class="shrink-0">{formatBytes(p.file.size)}</span>{/if}
								</div>
								{#if item.note && p}
									<p class="text-sm font-semibold {item.status === 'failed' ? 'text-danger' : 'text-muted'}" role={item.status === 'failed' ? 'alert' : undefined}>
										{item.note}
									</p>
								{/if}
								{#if item.status !== 'invalid' && item.status !== 'done'}
									<textarea
										class="field min-h-16 resize-y px-2.5 py-2 text-sm"
										maxlength={CAPTION_MAX}
										placeholder="Caption (optional)"
										bind:value={item.caption}
										disabled={busy}
									></textarea>
									<div class="label flex justify-between text-muted">
										{#if items.length > 1 && item.caption && !busy}
											<button type="button" class="hover:text-ink" onclick={() => captionToAll(item)}>use for all</button>
										{:else}
											<span></span>
										{/if}
										<span>{item.caption.length}/{CAPTION_MAX}</span>
									</div>
								{:else if item.status === 'done' && item.caption}
									<p class="line-clamp-2 text-sm">{item.caption}</p>
								{/if}
							</div>
						</li>
					{/each}
				</ul>
			{/if}
		</div>

		<!-- Sidebar -->
		<aside class="space-y-5 lg:sticky lg:top-24 lg:self-start">
			<div class="box space-y-4 p-5">
				<Turnstile bind:this={widget} siteKey={data.turnstileSiteKey} action="upload" bind:token />

				{#if error}
					<p class="border-2 border-ink bg-accent px-3 py-2 text-sm font-semibold" role="alert">{error}</p>
				{/if}

				{#if busy || inFlight.length}
					<div class="space-y-2 max-sm:hidden" aria-live="polite">
						<div class="h-4 border-2 border-ink bg-card">
							<div class="h-full bg-accent transition-[width] duration-200" style="width: {Math.round(overall * 100)}%"></div>
						</div>
						<p class="label">
							{doneItems.length} posted · {inFlight.length} in progress · {Math.round(overall * 100)}%
						</p>
					</div>
				{/if}

				<button class="btn btn-ink w-full py-3 text-base max-sm:hidden" disabled={busy || preparing || !sendable.length}>
					{#if busy}
						Posting…
					{:else if preparing}
						Preparing files…
					{:else if sendable.some((i) => i.status === 'failed')}
						Retry {sendable.length} →
					{:else}
						Post {sendable.length > 1 ? `${sendable.length} files` : 'it'} →
					{/if}
				</button>

				{#if doneItems.length && !busy}
					<div class="flex flex-wrap gap-2 border-t-2 border-dashed border-line pt-4">
						<a href="/u/{page.data.user?.id}" class="btn">Your uploads</a>
						<button type="button" class="btn" onclick={clearDone}>Clear posted</button>
					</div>
				{/if}
			</div>

			<ul class="label space-y-1 text-muted">
				<li>Up to {BULK_MAX_FILES} files at once, each its own post</li>
				<li>Images · JPEG PNG WebP GIF AVIF HEIC · up to {formatBytes(IMAGE_MAX_BYTES)}</li>
				<li>Videos · MP4 MOV WebM MKV · up to {formatBytes(VIDEO_MAX_BYTES)} & {formatDuration(VIDEO_MAX_SECONDS)}</li>
				<li>Photo location & camera data are stripped automatically</li>
			</ul>
		</aside>

		<!-- Phones: the post button stays reachable above the tab bar however long the list gets -->
		{#if items.length}
			<div
				class="sticky bottom-[calc(4rem+env(safe-area-inset-bottom))] z-30 -mx-4 space-y-2 border-t-2 border-ink bg-paper/95 px-4 py-3 backdrop-blur-[2px] sm:hidden"
			>
				{#if busy || inFlight.length}
					<div class="flex items-center gap-3" aria-live="polite">
						<div class="h-2.5 flex-1 border-2 border-ink bg-card">
							<div class="h-full bg-accent transition-[width] duration-200" style="width: {Math.round(overall * 100)}%"></div>
						</div>
						<span class="label shrink-0">{doneItems.length}/{doneItems.length + inFlight.length + sendable.length}</span>
					</div>
				{/if}
				<button class="btn btn-ink w-full py-3 text-base" disabled={busy || preparing || !sendable.length}>
					{#if busy}
						Posting… {Math.round(overall * 100)}%
					{:else if preparing}
						Preparing files…
					{:else if sendable.some((i) => i.status === 'failed')}
						Retry {sendable.length} →
					{:else}
						Post {sendable.length > 1 ? `${sendable.length} files` : 'it'} →
					{/if}
				</button>
			</div>
		{/if}
	</form>
</div>
