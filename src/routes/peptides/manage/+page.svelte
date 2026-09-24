<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ConfirmDialog from '$lib/components/ConfirmDialog.svelte';
	import CompoundModal from '$lib/components/peptides/CompoundModal.svelte';
	import ProtocolModal from '$lib/components/peptides/ProtocolModal.svelte';
	import VialModal from '$lib/components/peptides/VialModal.svelte';
	import { containerConcentrationMgMl } from '$lib/utils/delivery';
	import {
		CONTAINER_FORM_LABELS,
		blendRatioSummary,
		categoryLabel,
		formatDose,
		formatHalfLife,
		suggestBlendComponentMg
	} from '$lib/utils/peptides';
	import { isLoadingPhaseOn, isTaperPhaseOn, loadingEndDate, loadingOf, taperOf, taperStartDate } from '$lib/utils/peptideSchedule';
	import { todayIso } from '$lib/utils/todayIso';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Compound = PageData['peptides'][number];
	type Proto = PageData['protocols'][number];
	type Vial = PageData['vials'][number];

	const today = todayIso();
	const peptideById = $derived(new Map(data.peptides.map((p) => [p.id, p])));

	let compoundOpen = $state(false);
	let editingCompound = $state<Compound | null>(null);
	let protocolOpen = $state(false);
	let editingProtocol = $state<Proto | null>(null);
	let vialOpen = $state(false);
	let editingVial = $state<Vial | null>(null);

	let deleteOpen = $state(false);
	let deleting = $state<Compound | null>(null);
	const deletingProtocols = $derived(deleting ? data.protocols.filter((p) => p.peptideId === deleting!.id).length : 0);
	const deletingVials = $derived(deleting ? data.vials.filter((v) => v.peptideId === deleting!.id).length : 0);
	const usedInBlends = $derived(
		deleting ? data.peptides.filter((b) => b.isBlend && (b.components ?? []).some((c) => c.peptideId === deleting!.id)) : []
	);

	function confirmDelete(p: Compound) {
		deleting = p;
		deleteOpen = true;
	}
</script>

<svelte:head><title>Manage peptides · Fitness Tracker</title></svelte:head>

<PageHeader title="Manage" back="/peptides" />

{#if !data.encryptionReady}
	<div class="mx-auto max-w-md px-4">
		<Card><p class="text-sm text-[var(--color-text-muted)]">Set <code>PHOTO_ENCRYPTION_KEY</code> to enable peptide tracking.</p></Card>
	</div>
{:else}
	<div class="mx-auto max-w-md px-4 pb-8 space-y-7">
		<!-- Compounds -->
		<section>
			<div class="flex items-center justify-between mb-2 px-1">
				<h2 class="section-label">Compounds</h2>
				<button type="button" onclick={() => ((editingCompound = null), (compoundOpen = true))} class="text-sm text-[var(--color-accent)] font-medium">
					+ Add
				</button>
			</div>
			{#if data.peptides.length === 0}
				<Card>
					<p class="text-sm text-[var(--color-text-muted)] mb-3">No compounds yet.</p>
					<form method="POST" action="?/seedPresets" use:enhance>
						<Button type="submit" variant="secondary" full class="w-full">Add common peptides</Button>
					</form>
				</Card>
			{:else}
				<Card padded={false} class="divide-y divide-[var(--color-border)]">
					{#each data.peptides as p (p.id)}
						<div class="flex items-center gap-3 px-4 py-3">
							<a href={`/peptides/${p.id}`} class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] truncate {p.active ? '' : 'opacity-50'}">
									{p.name}
									{#if p.isBlend}<span class="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)] align-middle">Blend</span>{/if}
								</p>
								<p class="text-xs text-[var(--color-text-muted)]">
									{categoryLabel(p.category)}{#if p.vialMg}{' · '}{p.vialMg} mg vial{/if}{#if p.halfLifeHours}{' · '}{formatHalfLife(p.halfLifeHours)} half-life{/if}{#if p.doseCount}{' · '}{p.doseCount} dose{p.doseCount === 1 ? '' : 's'}{/if}{#if !p.active}{' · '}inactive{/if}
								</p>
								{#if p.isBlend && p.components}
									<p class="text-xs text-[var(--color-text-muted)] mt-0.5">{blendRatioSummary(p.components)}</p>
								{/if}
							</a>
							<button
								type="button"
								aria-label="Edit"
								onclick={() => ((editingCompound = p), (compoundOpen = true))}
								class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
							>
								<Icon name="edit" size={16} />
							</button>
							<form method="POST" action="?/togglePeptide" use:enhance>
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="active" value={(!p.active).toString()} />
								<button
									type="submit"
									aria-label={p.active ? 'Deactivate' : 'Activate'}
									title={p.active ? 'Deactivate (keeps history)' : 'Activate'}
									class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
								>
									<Icon name={p.active ? 'check' : 'plus'} size={16} />
								</button>
							</form>
							<button
								type="button"
								aria-label="Delete"
								onclick={() => confirmDelete(p)}
								class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
							>
								<Icon name="trash" size={16} />
							</button>
						</div>
					{/each}
				</Card>
			{/if}
		</section>

		<!-- Protocols -->
		<section>
			<div class="flex items-center justify-between mb-2 px-1">
				<h2 class="section-label">Protocols</h2>
				{#if data.peptides.length > 0}
					<button type="button" onclick={() => ((editingProtocol = null), (protocolOpen = true))} class="text-sm text-[var(--color-accent)] font-medium">
						+ Add
					</button>
				{/if}
			</div>
			{#if data.protocols.length === 0}
				<p class="text-sm text-[var(--color-text-muted)] px-1">A protocol sets a dose + schedule so doses show as “due”.</p>
			{:else}
				<Card padded={false} class="divide-y divide-[var(--color-border)]">
					{#each data.protocols as p (p.id)}
						{@const loading = loadingOf(p)}
						{@const taper = taperOf(p)}
						<div class="flex items-center gap-3 px-4 py-3">
							<a href={`/peptides/${p.peptideId}`} class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] truncate {p.active ? '' : 'opacity-50'}">
									{p.peptideName} <span class="text-[var(--color-text-muted)] font-normal tabular-nums">· {formatDose(p.doseMcg)}</span>
								</p>
								<p class="text-xs text-[var(--color-text-muted)]">
									{p.schedule}
									{#if p.cycleWeeksOn && p.cycleWeeksOff}{' · '}{p.cycleWeeksOn}w on / {p.cycleWeeksOff}w off{/if}
									{#if p.components?.length}{' · '}custom mix{/if}
									{#if !p.active}{' · '}paused{/if}
								</p>
								{#if loading}
									<p class="text-xs text-[var(--color-accent)] mt-0.5">
										{#if isLoadingPhaseOn(p.startDate, loading, today)}
											Loading {formatDose(loading.doseMcg)} through {loadingEndDate(p.startDate, loading)}
										{:else}
											Loading phase done · maintenance {formatDose(p.doseMcg)}
										{/if}
									</p>
								{/if}
								{#if taper}
									<p class="text-xs text-[var(--color-accent)] mt-0.5">
										{#if isTaperPhaseOn(p.startDate, loading, taper, today)}
											Tapered to {formatDose(taper.doseMcg)} since {taperStartDate(p.startDate, loading, taper)}
										{:else}
											Tapers to {formatDose(taper.doseMcg)} from {taperStartDate(p.startDate, loading, taper)}
										{/if}
										{#if p.endDate}{' · '}runs through {p.endDate}{:else}{' · '}then runs indefinitely{/if}
									</p>
								{/if}
							</a>
							<button
								type="button"
								aria-label="Edit"
								onclick={() => ((editingProtocol = p), (protocolOpen = true))}
								class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
							>
								<Icon name="edit" size={16} />
							</button>
							<form method="POST" action="?/toggleProtocol" use:enhance>
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="active" value={(!p.active).toString()} />
								<button
									type="submit"
									aria-label={p.active ? 'Pause' : 'Resume'}
									class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
								>
									<Icon name={p.active ? 'check' : 'clock'} size={16} />
								</button>
							</form>
							<form method="POST" action="?/deleteProtocol" use:enhance>
								<input type="hidden" name="id" value={p.id} />
								<button
									type="submit"
									aria-label="Delete"
									class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
								>
									<Icon name="trash" size={16} />
								</button>
							</form>
						</div>
					{/each}
				</Card>
			{/if}
		</section>

		<!-- Vials -->
		<section>
			<div class="flex items-center justify-between mb-2 px-1">
				<h2 class="section-label">Vials</h2>
				{#if data.peptides.length > 0}
					<button type="button" onclick={() => ((editingVial = null), (vialOpen = true))} class="text-sm text-[var(--color-accent)] font-medium">+ Add</button>
				{/if}
			</div>
			{#if data.vials.length === 0}
				<p class="text-sm text-[var(--color-text-muted)] px-1">Track reconstituted vials for the calculator and supply alerts.</p>
			{:else}
				<Card padded={false} class="divide-y divide-[var(--color-border)]">
					{#each data.vials as v (v.id)}
						{@const blend = peptideById.get(v.peptideId)}
						<div class="flex items-center gap-3 px-4 py-3">
							<a href={`/peptides/${v.peptideId}`} class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] truncate {v.depleted ? 'opacity-50 line-through' : ''}">
									{v.peptideName} ·
									{#if v.form === 'nasal_spray'}
										{CONTAINER_FORM_LABELS.nasal_spray}{#if containerConcentrationMgMl(v) != null}{' · '}{Math.round(containerConcentrationMgMl(v)! * 100) / 100} mg/mL{/if}{#if v.actuationVolumeUl}{' · '}{v.actuationVolumeUl} µL/spray{/if}
									{:else if v.form === 'patches'}
										{CONTAINER_FORM_LABELS.patches}{#if v.unitMassMcg}{' · '}{formatDose(v.unitMassMcg)}/patch{/if}{#if v.unitCount}{' · '}{v.unitCount} in box{/if}
									{:else}
										{v.vialMg} mg{#if v.bacWaterMl} in {v.bacWaterMl} mL{/if}
									{/if}
								</p>
								<p class="text-xs text-[var(--color-text-muted)]">
									{v.dosesLogged} dose{v.dosesLogged === 1 ? '' : 's'} logged{#if v.expiresAt}{' · '}expires {v.expiresAt}{/if}
								</p>
								{#if blend?.isBlend && blend.components && v.vialMg}
									<p class="text-xs text-[var(--color-text-muted)] mt-0.5">
										Est. {suggestBlendComponentMg(v.vialMg, blend.components).map((c) => `${c.name} ${c.mg}mg`).join(' · ')}
									</p>
								{/if}
							</a>
							<button
								type="button"
								aria-label="Edit"
								onclick={() => ((editingVial = v), (vialOpen = true))}
								class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
							>
								<Icon name="edit" size={16} />
							</button>
							<form method="POST" action="?/toggleVial" use:enhance>
								<input type="hidden" name="id" value={v.id} />
								<input type="hidden" name="depleted" value={(!v.depleted).toString()} />
								<button type="submit" class="h-8 px-2.5 flex items-center rounded-full text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
									{v.depleted ? 'Restore' : 'Used up'}
								</button>
							</form>
							<form method="POST" action="?/deleteVial" use:enhance>
								<input type="hidden" name="id" value={v.id} />
								<button
									type="submit"
									aria-label="Delete"
									class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
								>
									<Icon name="trash" size={16} />
								</button>
							</form>
						</div>
					{/each}
				</Card>
			{/if}
		</section>
	</div>

	<CompoundModal bind:open={compoundOpen} compound={editingCompound} />
	<ProtocolModal bind:open={protocolOpen} compounds={data.peptides} protocol={editingProtocol} />
	<VialModal bind:open={vialOpen} compounds={data.peptides} vial={editingVial} />

	<ConfirmDialog bind:open={deleteOpen} title={`Delete ${deleting?.name ?? 'compound'}?`}>
		{#snippet children()}
			{#if deleting}
				<p>
					This permanently deletes <strong>{deleting.name}</strong> and everything logged against it:
					{deleting.doseCount} dose{deleting.doseCount === 1 ? '' : 's'}, {deletingProtocols} protocol{deletingProtocols === 1 ? '' : 's'} and
					{deletingVials} container{deletingVials === 1 ? '' : 's'}. It can't be undone.
				</p>
				{#if usedInBlends.length > 0}
					<p class="mt-2 text-[var(--color-text-muted)]">
						It's also a component of {usedInBlends.map((b) => b.name).join(', ')} — those blends' doses stay, but will show it by name only.
					</p>
				{/if}
				<p class="mt-2 text-[var(--color-text-muted)]">Stopped taking it? Deactivating hides it but keeps the history.</p>
			{/if}
		{/snippet}
		{#snippet actions()}
			{#if deleting}
				{#if deleting.active}
					<form method="POST" action="?/togglePeptide" use:enhance={() => async ({ update }) => ((deleteOpen = false), await update())}>
						<input type="hidden" name="id" value={deleting.id} />
						<input type="hidden" name="active" value="false" />
						<Button type="submit" variant="secondary" full class="w-full">Deactivate instead</Button>
					</form>
				{/if}
				<form method="POST" action="?/deletePeptide" use:enhance={() => async ({ update }) => ((deleteOpen = false), await update())}>
					<input type="hidden" name="id" value={deleting.id} />
					<input type="hidden" name="confirm" value="yes" />
					<Button type="submit" variant="danger" full class="w-full">Delete forever</Button>
				</form>
			{/if}
		{/snippet}
	</ConfirmDialog>
{/if}
