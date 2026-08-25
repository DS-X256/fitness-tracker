<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import HintCard from '$lib/components/HintCard.svelte';
	import UploadPeptidePhotoModal from '$lib/components/peptides/UploadPeptidePhotoModal.svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let uploadOpen = $state(false);

	const peptideFilters = $derived([
		{ value: '', label: 'All' },
		...data.peptides.map((p) => ({ value: String(p.id), label: p.name }))
	]);

	function filterTo(peptideId: string) {
		goto(peptideId ? `/peptides/photos?peptideId=${peptideId}` : '/peptides/photos', { keepFocus: true, noScroll: true });
	}

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function peptideName(id: number | null): string | null {
		if (id == null) return null;
		return data.peptides.find((p) => p.id === id)?.name ?? null;
	}
</script>

<svelte:head><title>Peptide photos · Fitness Tracker</title></svelte:head>

<PageHeader title="Progress photos" back="/peptides">
	{#snippet actions()}
		<button type="button" aria-label="Add photo" onclick={() => (uploadOpen = true)} class="h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
			<Icon name="plus" size={20} />
		</button>
	{/snippet}
</PageHeader>

<div class="mx-auto max-w-md px-4 pb-4 space-y-4">
	{#if !data.encryptionReady}
		<Card>
			<div class="flex items-start gap-2 text-sm text-[var(--color-danger)]">
				<Icon name="x" size={18} class="mt-0.5 shrink-0" />
				<p>Photo encryption isn't configured on this server (<code>PHOTO_ENCRYPTION_KEY</code> is unset), so uploads are disabled. Set it and restart to enable peptide progress photos.</p>
			</div>
		</Card>
	{/if}

	<HintCard id="peptide-photos-intro" icon="camera">
		Photos are strictly private to your account, encrypted at rest, and stripped of location/camera metadata. Tag a compound to keep a per-peptide gallery, or leave it general.
	</HintCard>

	{#if data.peptides.length > 0}
		<div class="flex gap-2 overflow-x-auto pb-1">
			{#each peptideFilters as f (f.value)}
				<Chip selected={(data.peptideId ? String(data.peptideId) : '') === f.value} onclick={() => filterTo(f.value)}>{f.label}</Chip>
			{/each}
		</div>
	{/if}

	{#if data.photos.length === 0}
		<EmptyState icon="camera" title={data.peptideId ? 'No photos for this compound' : 'No progress photos yet'} description={data.encryptionReady ? 'Add your first photo to start tracking visible progress over time.' : 'Configure PHOTO_ENCRYPTION_KEY to enable photo uploads.'}>
			{#if data.encryptionReady}
				<Button variant="primary" onclick={() => (uploadOpen = true)}>
					<Icon name="plus" size={18} />
					Add photo
				</Button>
			{/if}
		</EmptyState>
	{:else}
		<div class="grid grid-cols-2 gap-3">
			{#each data.photos as photo (photo.id)}
				<div class="relative overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-alt)]">
					<img src={`/peptides/photos/${photo.id}/file`} alt={`Progress photo ${fmtDate(photo.date)}`} class="aspect-[3/4] w-full object-cover" loading="lazy" />
					<div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2">
						<p class="text-xs font-medium text-white tabular-nums">{fmtDate(photo.date)}</p>
						{#if peptideName(photo.peptideId) || photo.caption}
							<p class="truncate text-[11px] text-white/80">
								{#if peptideName(photo.peptideId)}{peptideName(photo.peptideId)}{/if}{#if peptideName(photo.peptideId) && photo.caption} · {/if}{photo.caption ?? ''}
							</p>
						{/if}
					</div>
					<form method="POST" action="?/delete" use:enhance class="absolute right-1.5 top-1.5">
						<input type="hidden" name="id" value={photo.id} />
						<button type="submit" aria-label={`Delete photo ${fmtDate(photo.date)}`} class="h-8 w-8 flex items-center justify-center rounded-full bg-black/45 text-white hover:bg-[var(--color-danger)]">
							<Icon name="trash" size={15} />
						</button>
					</form>
				</div>
			{/each}
		</div>
	{/if}
</div>

<UploadPeptidePhotoModal bind:open={uploadOpen} peptides={data.peptides} defaultPeptideId={data.peptideId} />
