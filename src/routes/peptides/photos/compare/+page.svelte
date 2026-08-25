<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import Button from '$lib/components/Button.svelte';
	import PhotoCompareSlider from '$lib/components/PhotoCompareSlider.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	// Default to a natural before/after: oldest on the left, newest on the right. `photos` is newest-first.
	const oldest = $derived(data.photos[data.photos.length - 1]);
	const newest = $derived(data.photos[0]);

	let leftId = $state<number | null>(null);
	let rightId = $state<number | null>(null);

	$effect(() => {
		if (leftId === null && oldest) leftId = oldest.id;
		if (rightId === null && newest) rightId = newest.id;
	});

	function peptideName(id: number | null): string | null {
		if (id == null) return null;
		return data.peptides.find((p) => p.id === id)?.name ?? null;
	}

	const options = $derived(
		data.photos.map((p) => ({
			id: p.id,
			label: `${fmtDate(p.date)}${peptideName(p.peptideId) ? ` · ${peptideName(p.peptideId)}` : ''}`
		}))
	);

	const left = $derived(data.photos.find((p) => p.id === leftId) ?? null);
	const right = $derived(data.photos.find((p) => p.id === rightId) ?? null);

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:head><title>Compare · Fitness Tracker</title></svelte:head>

<PageHeader title="Compare" back="/peptides/photos" />

<div class="mx-auto max-w-md px-4 pb-4 space-y-4">
	{#if data.photos.length < 2}
		<EmptyState icon="camera" title="Need two photos" description="Add at least two progress photos to compare them.">
			<Button href="/peptides/photos" variant="primary">Back to photos</Button>
		</EmptyState>
	{:else}
		<div class="grid grid-cols-2 gap-3">
			<select
				aria-label="Before photo"
				value={leftId}
				onchange={(e) => (leftId = Number((e.currentTarget as HTMLSelectElement).value))}
				class="w-full h-10 px-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
			>
				{#each options as opt (opt.id)}
					<option value={opt.id}>{opt.label}</option>
				{/each}
			</select>
			<select
				aria-label="After photo"
				value={rightId}
				onchange={(e) => (rightId = Number((e.currentTarget as HTMLSelectElement).value))}
				class="w-full h-10 px-2.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-xs text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
			>
				{#each options as opt (opt.id)}
					<option value={opt.id}>{opt.label}</option>
				{/each}
			</select>
		</div>

		{#if left && right}
			<PhotoCompareSlider
				beforeSrc={`/peptides/photos/${left.id}/file`}
				afterSrc={`/peptides/photos/${right.id}/file`}
				beforeLabel={fmtDate(left.date)}
				afterLabel={fmtDate(right.date)}
			/>
			<p class="text-center text-xs text-[var(--color-text-muted)]">Drag the handle to compare</p>
		{/if}

		{#if left?.caption || right?.caption}
			<div class="grid grid-cols-2 gap-3 text-center text-xs text-[var(--color-text-muted)]">
				<p>{left?.caption ?? ''}</p>
				<p>{right?.caption ?? ''}</p>
			</div>
		{/if}
	{/if}
</div>
