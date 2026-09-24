<script lang="ts">
	// Add/edit a container: a reconstituted vial, a nasal spray or a box of patches. For a blend, shows
	// what's estimated to be in this particular vial per component.
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import TextareaField from '$lib/components/TextareaField.svelte';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import { containerConcentrationMgMl, mcgPerActuation, actuationsPerContainer } from '$lib/utils/delivery';
	import { CONTAINER_FORM_LABELS, formatDose, suggestBlendComponentMg, type BlendComponent, type ContainerForm } from '$lib/utils/peptides';

	type CompoundOpt = { id: number; name: string; active: boolean; isBlend: boolean; components: BlendComponent[] | null; vialMg: number | null };
	type Vial = {
		id: number;
		peptideId: number;
		form: ContainerForm;
		vialMg: number | null;
		bacWaterMl: number | null;
		concentrationMgMl: number | null;
		percentWv: number | null;
		actuationVolumeUl: number | null;
		primingActuations: number | null;
		unitCount: number | null;
		unitMassMcg: number | null;
		reconstitutedAt: string | null;
		expiresAt: string | null;
		notes: string | null;
	};

	let {
		open = $bindable(false),
		compounds,
		vial = null,
		defaultPeptideId = null
	}: { open?: boolean; compounds: CompoundOpt[]; vial?: Vial | null; defaultPeptideId?: number | null } = $props();

	// Serum/capsules aren't wired up yet — topical/oral land with their own phase.
	const FORMS: ContainerForm[] = ['vial', 'nasal_spray', 'patches'];

	let peptideId = $state<number | null>(null);
	let form = $state<ContainerForm>('vial');
	let vialMg = $state<number | null>(null);
	let waterMl = $state<number | null>(null);
	let concentrationMgMl = $state<number | null>(null);
	let actuationVolumeUl = $state<number | null>(null);
	let primingActuations = $state<number | null>(null);
	let unitCount = $state<number | null>(null);
	let unitMassMcg = $state<number | null>(null);
	let recon = $state('');
	let expires = $state('');
	let notes = $state('');
	let error = $state('');

	let wasOpen = false;
	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) untrack(init);
		wasOpen = isOpen;
	});
	function init() {
		const v = vial;
		peptideId = v?.peptideId ?? defaultPeptideId ?? compounds.find((c) => c.active)?.id ?? null;
		form = v?.form ?? 'vial';
		// A new vial of a compound with a usual size starts from that size.
		vialMg = v ? v.vialMg : (compounds.find((c) => c.id === peptideId)?.vialMg ?? null);
		waterMl = v?.bacWaterMl ?? null;
		concentrationMgMl = v?.concentrationMgMl ?? null;
		actuationVolumeUl = v?.actuationVolumeUl ?? null;
		primingActuations = v?.primingActuations ?? null;
		unitCount = v?.unitCount ?? null;
		unitMassMcg = v?.unitMassMcg ?? null;
		recon = v?.reconstitutedAt ?? '';
		expires = v?.expiresAt ?? '';
		notes = v?.notes ?? '';
		error = '';
	}

	const compound = $derived(compounds.find((c) => c.id === peptideId) ?? null);
	const concentration = $derived(containerConcentrationMgMl({ concentrationMgMl, vialMg, bacWaterMl: waterMl }));
	const mcgPerSpray = $derived(concentration != null && actuationVolumeUl ? mcgPerActuation(concentration, actuationVolumeUl) : null);
	const bottleLife = $derived(waterMl && actuationVolumeUl ? actuationsPerContainer(waterMl, actuationVolumeUl, primingActuations ?? 0) : null);
	const blendEstimate = $derived(compound?.isBlend && compound.components && vialMg ? suggestBlendComponentMg(vialMg, compound.components) : null);

	const inputClass =
		'w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]';
</script>

<Modal bind:open title={`${vial ? 'Edit' : 'Add'} ${CONTAINER_FORM_LABELS[form].toLowerCase()}`}>
	<form
		method="POST"
		action="/peptides/manage?/saveVial"
		class="space-y-4"
		use:enhance={() => async ({ result, update }) => {
			if (result.type === 'success') open = false;
			else if (result.type === 'failure') error = String(result.data?.error ?? 'Could not save');
			await update({ reset: false });
		}}
	>
		<input type="hidden" name="id" value={vial?.id ?? ''} />
		<input type="hidden" name="form" value={form} />
		<!-- No UI for % w/v yet; carry any existing value through an edit instead of wiping it. -->
		<input type="hidden" name="percentWv" value={vial?.percentWv ?? ''} />
		<div>
			<label for="v-pep" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Compound</label>
			<select id="v-pep" name="peptideId" bind:value={peptideId} class={inputClass}>
				{#each compounds.filter((c) => c.active || c.id === vial?.peptideId) as c (c.id)}<option value={c.id}>{c.name}</option>{/each}
			</select>
		</div>
		<div class="flex gap-1.5">
			{#each FORMS as f (f)}
				<Chip selected={form === f} onclick={() => (form = f)}>{CONTAINER_FORM_LABELS[f]}</Chip>
			{/each}
		</div>
		{#if form === 'vial'}
			<div class="grid grid-cols-2 gap-3">
				<NumberField label="Vial size" name="vialMg" bind:value={vialMg} decimalText suffix="mg" />
				<NumberField label="Water added" name="bacWaterMl" bind:value={waterMl} decimalText suffix="mL" />
			</div>
			{#if vialMg && waterMl}
				<div class="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3.5 py-2.5 text-xs text-[var(--color-text-muted)] tabular-nums">
					Concentration: {Math.round((vialMg * 1000) / waterMl)} mcg/mL · 10 units = {formatDose((vialMg * 1000 * 0.1) / waterMl)}
				</div>
			{/if}
			{#if blendEstimate}
				<p class="text-xs text-[var(--color-text-muted)]">Est. in this vial: {blendEstimate.map((c) => `${c.name} ${c.mg} mg`).join(' · ')}</p>
			{/if}
		{:else if form === 'nasal_spray'}
			<NumberField label="Concentration (optional)" name="concentrationMgMl" bind:value={concentrationMgMl} decimalText suffix="mg/mL" />
			<p class="text-xs text-[var(--color-text-muted)] -mt-2">Or leave blank and enter powder + volume below to calculate it.</p>
			<div class="grid grid-cols-2 gap-3">
				<NumberField label="Powder (optional)" name="vialMg" bind:value={vialMg} decimalText suffix="mg" />
				<NumberField label="Volume" name="bacWaterMl" bind:value={waterMl} decimalText suffix="mL" />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<NumberField label="Spray volume" name="actuationVolumeUl" bind:value={actuationVolumeUl} decimalText suffix="µL" />
				<NumberField label="Priming sprays" name="primingActuations" bind:value={primingActuations} suffix="sprays" />
			</div>
			{#if mcgPerSpray != null || bottleLife != null}
				<div class="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3.5 py-2.5 text-xs text-[var(--color-text-muted)] tabular-nums space-y-0.5">
					{#if concentration != null}<p>Concentration: {Math.round(concentration * 100) / 100} mg/mL</p>{/if}
					{#if mcgPerSpray != null}<p>{Math.round(mcgPerSpray)} mcg/spray</p>{/if}
					{#if bottleLife != null}<p>{bottleLife.total} sprays total · {bottleLife.usable} usable after priming</p>{/if}
				</div>
			{/if}
		{:else if form === 'patches'}
			<div class="grid grid-cols-2 gap-3">
				<NumberField label="Patches in box" name="unitCount" bind:value={unitCount} suffix="patches" />
				<NumberField label="Strength per patch" name="unitMassMcg" bind:value={unitMassMcg} decimalText suffix="mcg" />
			</div>
			{#if unitCount && unitMassMcg}
				<div class="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3.5 py-2.5 text-xs text-[var(--color-text-muted)] tabular-nums">
					{formatDose(unitCount * unitMassMcg)} total in box
				</div>
			{/if}
		{/if}
		<div class="grid grid-cols-2 gap-3">
			{#if form !== 'patches'}
				<div>
					<label for="v-recon" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Reconstituted</label>
					<input id="v-recon" type="date" name="reconstitutedAt" bind:value={recon} class={inputClass} />
				</div>
			{/if}
			<div>
				<label for="v-exp" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Expires</label>
				<input id="v-exp" type="date" name="expiresAt" bind:value={expires} class={inputClass} />
			</div>
		</div>
		<TextareaField label="Notes" name="notes" bind:value={notes} rows={2} placeholder="Optional — batch, source, etc." />
		{#if error}<p class="text-sm text-[var(--color-danger)]">{error}</p>{/if}
		<Button type="submit" variant="primary" full class="w-full">Save {CONTAINER_FORM_LABELS[form].toLowerCase()}</Button>
	</form>
</Modal>
