<section class="box relative mt-2 mb-6 p-4 sm:p-5 md:mb-8">
	<div class="flex flex-wrap items-start justify-between gap-3">
		<div class="min-w-0">
			<p class="label text-muted">admin</p>
			<h2 class="display mt-1.5 text-2xl md:text-3xl">Export</h2>
			<p class="mt-2 max-w-prose text-sm text-muted">
				Download a zip with every post's full-size image or video, plus <span class="font-mono">posts.json</span>: captions,
				authors, votes, reactions, comments and who picked what. Large boards take a while to stream.
			</p>
		</div>
		<div class="flex shrink-0 flex-wrap gap-2">
			<!-- Plain downloads, not client-side navigations -->
			<a class="btn" href="/api/admin/export?scope=picked" data-sveltekit-reload>★ Picked only</a>
			<a class="btn btn-ink" href="/api/admin/export?scope=all" data-sveltekit-reload>Everything</a>
		</div>
	</div>
</section>
