<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import HintCard from '$lib/components/HintCard.svelte';
	import UploadProgressPhotoModal from '$lib/components/body/UploadProgressPhotoModal.svelte';
	import PhotoLightbox from '$lib/components/PhotoLightbox.svelte';
	import { goto } from '$app/navigation';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let uploadOpen = $state(false);
	let lightboxOpen = $state(false);
	let lightboxStartId = $state<number | null>(null);
	let lastTriggerEl: HTMLElement | null = null;

	const lightboxPhotos = $derived(
		data.photos.map((p) => ({
			id: p.id,
			date: p.date,
			label: p.pose ? p.pose[0].toUpperCase() + p.pose.slice(1) : null,
			caption: p.caption
		}))
	);

	function openLightbox(id: number, e: MouseEvent) {
		lastTriggerEl = e.currentTarget as HTMLElement;
		lightboxStartId = id;
		lightboxOpen = true;
	}

	const poseFilters = [
		{ value: '', label: 'All' },
		{ value: 'front', label: 'Front' },
		{ value: 'side', label: 'Side' },
		{ value: 'back', label: 'Back' }
	];

	function filterTo(pose: string) {
		goto(pose ? `/body/photos?pose=${pose}` : '/body/photos', { keepFocus: true, noScroll: true });
	}

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:head><title>Progress photos · Fitness Tracker</title></svelte:head>

<PageHeader title="Progress photos" back="/body">
	{#snippet actions()}
		{#if data.photos.length > 1}
			<a href="/body/photos/compare" aria-label="Compare photos" class="h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
				<Icon name="chart" size={18} />
			</a>
		{/if}
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
				<p>Photo encryption isn't configured on this server (<code>PHOTO_ENCRYPTION_KEY</code> is unset), so uploads are disabled. Set it and restart to enable progress photos.</p>
			</div>
		</Card>
	{/if}

	<HintCard id="photos-intro" icon="camera">
		Photos are strictly private to your account, encrypted at rest, and stripped of location/camera metadata. Tag a pose to line up before/after shots in Compare.
	</HintCard>

	<div class="flex gap-2 overflow-x-auto pb-1">
		{#each poseFilters as f (f.value)}
			<Chip selected={(data.pose ?? '') === f.value} onclick={() => filterTo(f.value)}>{f.label}</Chip>
		{/each}
	</div>

	{#if data.photos.length === 0}
		<EmptyState icon="camera" title={data.pose ? 'No photos for this pose' : 'No progress photos yet'} description={data.encryptionReady ? 'Add your first photo to start tracking visible progress over time.' : 'Configure PHOTO_ENCRYPTION_KEY to enable photo uploads.'}>
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
					<button type="button" class="block w-full" aria-label={`View photo ${fmtDate(photo.date)}`} onclick={(e) => openLightbox(photo.id, e)}>
						<img src={`/body/photos/${photo.id}/file`} alt={`Progress photo ${fmtDate(photo.date)}`} class="aspect-[3/4] w-full object-cover" loading="lazy" />
						<div class="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/60 to-transparent px-2.5 py-2">
							<p class="text-xs font-medium text-white tabular-nums">{fmtDate(photo.date)}</p>
							{#if photo.pose || photo.caption}
								<p class="truncate text-[11px] text-white/80">
									{#if photo.pose}<span class="capitalize">{photo.pose}</span>{/if}{#if photo.pose && photo.caption} · {/if}{photo.caption ?? ''}
								</p>
							{/if}
						</div>
					</button>
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

<UploadProgressPhotoModal bind:open={uploadOpen} />
<PhotoLightbox
	bind:open={lightboxOpen}
	photos={lightboxPhotos}
	startId={lightboxStartId}
	srcBase="/body/photos"
	onclose={() => lastTriggerEl?.focus()}
/>
