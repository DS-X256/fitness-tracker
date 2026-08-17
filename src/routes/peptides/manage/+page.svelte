<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import TextareaField from '$lib/components/TextareaField.svelte';
	import ReconstitutionCalculator from '$lib/components/peptides/ReconstitutionCalculator.svelte';
	import { todayIso } from '$lib/utils/todayIso';
	import { containerConcentrationMgMl, mcgPerActuation, actuationsPerContainer } from '$lib/utils/delivery';
	import {
		ADMIN_ROUTES,
		CONTAINER_FORM_LABELS,
		PEPTIDE_CATEGORIES,
		categoryLabel,
		formatDose,
		type ContainerForm
	} from '$lib/utils/peptides';
	import { FREQUENCY_LABELS, weekdayMaskLabel, type Frequency } from '$lib/utils/peptideSchedule';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const inputClass =
		'w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]';
	const WEEKDAYS = [
		{ d: 1, label: 'Mo' },
		{ d: 2, label: 'Tu' },
		{ d: 3, label: 'We' },
		{ d: 4, label: 'Th' },
		{ d: 5, label: 'Fr' },
		{ d: 6, label: 'Sa' },
		{ d: 0, label: 'Su' }
	];

	// --- Compound modal ---
	let peptideOpen = $state(false);
	let pId = $state<number | null>(null);
	let pName = $state('');
	let pCategory = $state('');
	let pVialMg = $state<number | null>(null);
	let pNotes = $state('');
	let pError = $state('');
	function newPeptide() {
		pId = null; pName = ''; pCategory = ''; pVialMg = null; pNotes = ''; pError = '';
		peptideOpen = true;
	}
	function editPeptide(p: PageData['peptides'][number]) {
		pId = p.id; pName = p.name; pCategory = p.category ?? ''; pVialMg = p.vialMg; pNotes = p.notes ?? ''; pError = '';
		peptideOpen = true;
	}

	// --- Protocol modal ---
	let protoOpen = $state(false);
	let prId = $state<number | null>(null);
	let prPeptideId = $state<number | null>(null);
	let prDose = $state<number | null>(null);
	let prRoute = $state('');
	let prFreq = $state<Frequency>('daily');
	let prDays = $state<Set<number>>(new Set());
	let prPerWeek = $state<number | null>(null);
	let prTime = $state('');
	let prStart = $state(todayIso());
	let prEnd = $state('');
	let prOn = $state<number | null>(null);
	let prOff = $state<number | null>(null);
	let prRotate = $state(true);
	let prNotes = $state('');
	let prError = $state('');
	function newProtocol() {
		prId = null; prPeptideId = data.peptides[0]?.id ?? null; prDose = null; prRoute = ''; prFreq = 'daily';
		prDays = new Set(); prPerWeek = null; prTime = ''; prStart = todayIso(); prEnd = '';
		prOn = null; prOff = null; prRotate = true; prNotes = ''; prError = '';
		protoOpen = true;
	}
	function editProtocol(p: PageData['protocols'][number]) {
		prId = p.id; prPeptideId = p.peptideId; prDose = p.doseMcg; prRoute = p.route ?? ''; prFreq = p.frequency;
		prDays = new Set(WEEKDAYS.map((w) => w.d).filter((d) => ((p.weekdayMask ?? 0) & (1 << d)) !== 0));
		prPerWeek = p.perWeek; prTime = p.timeOfDay ?? ''; prStart = p.startDate; prEnd = p.endDate ?? '';
		prOn = p.cycleWeeksOn; prOff = p.cycleWeeksOff; prRotate = p.rotateSites; prNotes = p.notes ?? ''; prError = '';
		protoOpen = true;
	}
	function toggleDay(d: number) {
		const next = new Set(prDays);
		next.has(d) ? next.delete(d) : next.add(d);
		prDays = next;
	}

	// --- Vial modal ---
	let vialOpen = $state(false);
	let vPeptideId = $state<number | null>(null);
	let vForm = $state<ContainerForm>('vial');
	let vVialMg = $state<number | null>(null);
	let vWaterMl = $state<number | null>(null);
	let vConcentrationMgMl = $state<number | null>(null);
	let vActuationVolumeUl = $state<number | null>(null);
	let vPrimingActuations = $state<number | null>(null);
	let vUnitCount = $state<number | null>(null);
	let vUnitMassMcg = $state<number | null>(null);
	let vRecon = $state('');
	let vExpires = $state('');
	let vNotes = $state('');
	let vError = $state('');
	// Serum/capsules aren't wired up yet — topical/oral land with their own phase.
	const VIAL_FORMS: ContainerForm[] = ['vial', 'nasal_spray', 'patches'];
	function newVial() {
		vPeptideId = data.peptides[0]?.id ?? null; vForm = 'vial'; vVialMg = null; vWaterMl = null;
		vConcentrationMgMl = null; vActuationVolumeUl = null; vPrimingActuations = null;
		vUnitCount = null; vUnitMassMcg = null;
		vRecon = ''; vExpires = ''; vNotes = ''; vError = '';
		vialOpen = true;
	}
	// Effective mg/mL, whichever way it was entered — direct or derived from powder + volume.
	const vConcentration = $derived(containerConcentrationMgMl({ concentrationMgMl: vConcentrationMgMl, vialMg: vVialMg, bacWaterMl: vWaterMl }));
	const vMcgPerSpray = $derived(vConcentration != null && vActuationVolumeUl ? mcgPerActuation(vConcentration, vActuationVolumeUl) : null);
	const vBottleLife = $derived(
		vWaterMl && vActuationVolumeUl ? actuationsPerContainer(vWaterMl, vActuationVolumeUl, vPrimingActuations ?? 0) : null
	);

	function closeOn(setter: () => void) {
		return () => {
			return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: (o?: { reset?: boolean }) => Promise<void> }) => {
				if (result.type === 'success') setter();
				await update({ reset: false });
			};
		};
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
				<button type="button" onclick={newPeptide} class="text-sm text-[var(--color-accent)] font-medium">+ Add</button>
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
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] truncate {p.active ? '' : 'opacity-50'}">{p.name}</p>
								<p class="text-xs text-[var(--color-text-muted)]">
									{categoryLabel(p.category)}{#if p.vialMg} · {p.vialMg} mg vial{/if}{#if !p.active} · inactive{/if}
								</p>
							</div>
							<button type="button" aria-label="Edit" onclick={() => editPeptide(p)} class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
								<Icon name="edit" size={16} />
							</button>
							<form method="POST" action="?/togglePeptide" use:enhance>
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="active" value={(!p.active).toString()} />
								<button type="submit" aria-label={p.active ? 'Deactivate' : 'Activate'} class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
									<Icon name={p.active ? 'check' : 'plus'} size={16} />
								</button>
							</form>
							<form method="POST" action="?/deletePeptide" use:enhance>
								<input type="hidden" name="id" value={p.id} />
								<button type="submit" aria-label="Delete" class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]">
									<Icon name="trash" size={16} />
								</button>
							</form>
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
					<button type="button" onclick={newProtocol} class="text-sm text-[var(--color-accent)] font-medium">+ Add</button>
				{/if}
			</div>
			{#if data.protocols.length === 0}
				<p class="text-sm text-[var(--color-text-muted)] px-1">A protocol sets a dose + schedule so doses show as “due”.</p>
			{:else}
				<Card padded={false} class="divide-y divide-[var(--color-border)]">
					{#each data.protocols as p (p.id)}
						<div class="flex items-center gap-3 px-4 py-3">
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] truncate {p.active ? '' : 'opacity-50'}">
									{p.peptideName} <span class="text-[var(--color-text-muted)] font-normal tabular-nums">· {formatDose(p.doseMcg)}</span>
								</p>
								<p class="text-xs text-[var(--color-text-muted)]">
									{p.frequency === 'weekly' ? weekdayMaskLabel(p.weekdayMask) : FREQUENCY_LABELS[p.frequency]}
									{#if p.cycleWeeksOn && p.cycleWeeksOff} · {p.cycleWeeksOn}w on / {p.cycleWeeksOff}w off{/if}
									{#if !p.active} · paused{/if}
								</p>
							</div>
							<button type="button" aria-label="Edit" onclick={() => editProtocol(p)} class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
								<Icon name="edit" size={16} />
							</button>
							<form method="POST" action="?/toggleProtocol" use:enhance>
								<input type="hidden" name="id" value={p.id} />
								<input type="hidden" name="active" value={(!p.active).toString()} />
								<button type="submit" aria-label={p.active ? 'Pause' : 'Resume'} class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
									<Icon name={p.active ? 'check' : 'clock'} size={16} />
								</button>
							</form>
							<form method="POST" action="?/deleteProtocol" use:enhance>
								<input type="hidden" name="id" value={p.id} />
								<button type="submit" aria-label="Delete" class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]">
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
					<button type="button" onclick={newVial} class="text-sm text-[var(--color-accent)] font-medium">+ Add</button>
				{/if}
			</div>
			{#if data.vials.length === 0}
				<p class="text-sm text-[var(--color-text-muted)] px-1">Track reconstituted vials for the calculator and expiry alerts.</p>
			{:else}
				<Card padded={false} class="divide-y divide-[var(--color-border)]">
					{#each data.vials as v (v.id)}
						<div class="flex items-center gap-3 px-4 py-3">
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] truncate {v.depleted ? 'opacity-50 line-through' : ''}">
									{v.peptideName} ·
									{#if v.form === 'nasal_spray'}
										{CONTAINER_FORM_LABELS.nasal_spray}{#if containerConcentrationMgMl(v) != null} · {Math.round(containerConcentrationMgMl(v)! * 100) / 100} mg/mL{/if}{#if v.actuationVolumeUl} · {v.actuationVolumeUl} µL/spray{/if}
									{:else if v.form === 'patches'}
										{CONTAINER_FORM_LABELS.patches}{#if v.unitMassMcg} · {formatDose(v.unitMassMcg)}/patch{/if}{#if v.unitCount} · {v.unitCount} in box{/if}
									{:else}
										{v.vialMg} mg{#if v.bacWaterMl} in {v.bacWaterMl} mL{/if}
									{/if}
								</p>
								<p class="text-xs text-[var(--color-text-muted)]">
									{v.dosesLogged} dose{v.dosesLogged === 1 ? '' : 's'} logged{#if v.expiresAt} · expires {v.expiresAt}{/if}
								</p>
							</div>
							<form method="POST" action="?/toggleVial" use:enhance>
								<input type="hidden" name="id" value={v.id} />
								<input type="hidden" name="depleted" value={(!v.depleted).toString()} />
								<button type="submit" class="h-8 px-2.5 flex items-center rounded-full text-xs text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]">
									{v.depleted ? 'Restore' : 'Depleted'}
								</button>
							</form>
							<form method="POST" action="?/deleteVial" use:enhance>
								<input type="hidden" name="id" value={v.id} />
								<button type="submit" aria-label="Delete" class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]">
									<Icon name="trash" size={16} />
								</button>
							</form>
						</div>
					{/each}
				</Card>
			{/if}
		</section>
	</div>

	<!-- Compound modal -->
	<Modal bind:open={peptideOpen} title={pId ? 'Edit compound' : 'Add compound'}>
		<form method="POST" action="?/savePeptide" class="space-y-4" use:enhance={closeOn(() => (peptideOpen = false))}>
			<input type="hidden" name="id" value={pId ?? ''} />
			<div>
				<label for="p-name" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Name</label>
				<input id="p-name" name="name" bind:value={pName} required placeholder="e.g. BPC-157" class={inputClass} />
			</div>
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="p-cat" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Category</label>
					<select id="p-cat" name="category" bind:value={pCategory} class={inputClass}>
						<option value="">Uncategorized</option>
						{#each PEPTIDE_CATEGORIES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
					</select>
				</div>
				<NumberField label="Vial size" name="vialMg" bind:value={pVialMg} decimalText suffix="mg" />
			</div>
			<TextareaField label="Notes" name="notes" bind:value={pNotes} rows={2} placeholder="Optional" />
			{#if pError}<p class="text-sm text-[var(--color-danger)]">{pError}</p>{/if}
			<Button type="submit" variant="primary" full class="w-full">Save</Button>
		</form>
	</Modal>

	<!-- Protocol modal -->
	<Modal bind:open={protoOpen} title={prId ? 'Edit protocol' : 'Add protocol'}>
		<form method="POST" action="?/saveProtocol" class="space-y-4" use:enhance={closeOn(() => (protoOpen = false))}>
			<input type="hidden" name="id" value={prId ?? ''} />
			<input type="hidden" name="rotateSites" value={prRotate ? 'on' : ''} />
			<div>
				<label for="pr-pep" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Peptide</label>
				<select id="pr-pep" name="peptideId" bind:value={prPeptideId} class={inputClass}>
					{#each data.peptides as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</div>
			<div class="grid grid-cols-2 gap-3">
				<NumberField label="Dose" name="doseMcg" bind:value={prDose} decimalText suffix="mcg" />
				<div>
					<label for="pr-route" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Route</label>
					<select id="pr-route" name="route" bind:value={prRoute} class={inputClass}>
						<option value="">—</option>
						{#each ADMIN_ROUTES as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
					</select>
				</div>
			</div>
			<div>
				<label for="pr-freq" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Frequency</label>
				<select id="pr-freq" name="frequency" bind:value={prFreq} class={inputClass}>
					{#each Object.entries(FREQUENCY_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
				</select>
			</div>
			{#if prFreq === 'weekly'}
				<div>
					<p class="section-label mb-2">Days</p>
					<div class="flex gap-1.5">
						{#each WEEKDAYS as w (w.d)}
							{@const on = prDays.has(w.d)}
							<button type="button" onclick={() => toggleDay(w.d)} class={`flex-1 h-10 rounded-[var(--radius-md)] border text-sm ${on ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)] font-medium' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}>{w.label}</button>
						{/each}
					</div>
					{#each [...prDays] as d (d)}<input type="hidden" name="weekday" value={d} />{/each}
				</div>
			{:else if prFreq === 'x_per_week'}
				<NumberField label="Doses per week" name="perWeek" bind:value={prPerWeek} suffix="×/wk" />
			{/if}
			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="pr-start" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Start</label>
					<input id="pr-start" type="date" name="startDate" bind:value={prStart} class={inputClass} />
				</div>
				<div>
					<label for="pr-time" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Time of day</label>
					<input id="pr-time" name="timeOfDay" bind:value={prTime} placeholder="e.g. AM" class={inputClass} />
				</div>
			</div>
			<details class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3.5 py-2.5">
				<summary class="text-sm text-[var(--color-text-muted)] cursor-pointer select-none">Cycle & advanced</summary>
				<div class="mt-3 space-y-3">
					<div class="grid grid-cols-2 gap-3">
						<NumberField label="Weeks on" name="cycleWeeksOn" bind:value={prOn} suffix="wk" />
						<NumberField label="Weeks off" name="cycleWeeksOff" bind:value={prOff} suffix="wk" />
					</div>
					<div>
						<label for="pr-end" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">End date (optional)</label>
						<input id="pr-end" type="date" name="endDate" bind:value={prEnd} class={inputClass} />
					</div>
					<label class="flex items-center gap-2.5 text-sm text-[var(--color-text)]">
						<input type="checkbox" bind:checked={prRotate} class="h-4 w-4 accent-[var(--color-accent)]" />
						Suggest rotating injection sites
					</label>
					<TextareaField label="Notes" name="notes" bind:value={prNotes} rows={2} placeholder="Optional" />
				</div>
			</details>
			{#if prError}<p class="text-sm text-[var(--color-danger)]">{prError}</p>{/if}
			<Button type="submit" variant="primary" full class="w-full">Save protocol</Button>
		</form>
	</Modal>

	<!-- Vial modal -->
	<Modal bind:open={vialOpen} title={`Add ${CONTAINER_FORM_LABELS[vForm].toLowerCase()}`}>
		<form method="POST" action="?/saveVial" class="space-y-4" use:enhance={closeOn(() => (vialOpen = false))}>
			<input type="hidden" name="form" value={vForm} />
			<div>
				<label for="v-pep" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Peptide</label>
				<select id="v-pep" name="peptideId" bind:value={vPeptideId} class={inputClass}>
					{#each data.peptides as p (p.id)}<option value={p.id}>{p.name}</option>{/each}
				</select>
			</div>
			<div class="flex gap-1.5">
				{#each VIAL_FORMS as f (f)}
					<Chip selected={vForm === f} onclick={() => (vForm = f)}>{CONTAINER_FORM_LABELS[f]}</Chip>
				{/each}
			</div>
			{#if vForm === 'vial'}
				<div class="grid grid-cols-2 gap-3">
					<NumberField label="Vial size" name="vialMg" bind:value={vVialMg} decimalText suffix="mg" />
					<NumberField label="Water added" name="bacWaterMl" bind:value={vWaterMl} decimalText suffix="mL" />
				</div>
				{#if vVialMg && vWaterMl}
					<div class="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3.5 py-2.5 text-xs text-[var(--color-text-muted)] tabular-nums">
						Concentration: {Math.round((vVialMg * 1000) / vWaterMl)} mcg/mL
					</div>
				{/if}
			{:else if vForm === 'nasal_spray'}
				<NumberField label="Concentration (optional)" name="concentrationMgMl" bind:value={vConcentrationMgMl} decimalText suffix="mg/mL" />
				<p class="text-xs text-[var(--color-text-muted)] -mt-2">
					Or leave blank and enter powder + volume below to calculate it, same as a reconstituted vial.
				</p>
				<div class="grid grid-cols-2 gap-3">
					<NumberField label="Powder (optional)" name="vialMg" bind:value={vVialMg} decimalText suffix="mg" />
					<NumberField label="Volume" name="bacWaterMl" bind:value={vWaterMl} decimalText suffix="mL" />
				</div>
				<div class="grid grid-cols-2 gap-3">
					<NumberField label="Spray volume" name="actuationVolumeUl" bind:value={vActuationVolumeUl} decimalText suffix="µL" />
					<NumberField label="Priming sprays" name="primingActuations" bind:value={vPrimingActuations} suffix="sprays" />
				</div>
				{#if vMcgPerSpray != null || vBottleLife != null}
					<div class="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3.5 py-2.5 text-xs text-[var(--color-text-muted)] tabular-nums space-y-0.5">
						{#if vConcentration != null}<p>Concentration: {Math.round(vConcentration * 100) / 100} mg/mL</p>{/if}
						{#if vMcgPerSpray != null}<p>{Math.round(vMcgPerSpray)} mcg/spray</p>{/if}
						{#if vBottleLife != null}<p>{vBottleLife.total} sprays total · {vBottleLife.usable} usable after priming</p>{/if}
					</div>
				{/if}
			{:else if vForm === 'patches'}
				<div class="grid grid-cols-2 gap-3">
					<NumberField label="Patches in box" name="unitCount" bind:value={vUnitCount} suffix="patches" />
					<NumberField label="Strength per patch" name="unitMassMcg" bind:value={vUnitMassMcg} decimalText suffix="mcg" />
				</div>
				{#if vUnitCount && vUnitMassMcg}
					<div class="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3.5 py-2.5 text-xs text-[var(--color-text-muted)] tabular-nums">
						{formatDose(vUnitCount * vUnitMassMcg)} total in box
					</div>
				{/if}
			{/if}
			<div class="grid grid-cols-2 gap-3">
				{#if vForm !== 'patches'}
					<div>
						<label for="v-recon" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Reconstituted</label>
						<input id="v-recon" type="date" name="reconstitutedAt" bind:value={vRecon} class={inputClass} />
					</div>
				{/if}
				<div>
					<label for="v-exp" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Expires</label>
					<input id="v-exp" type="date" name="expiresAt" bind:value={vExpires} class={inputClass} />
				</div>
			</div>
			<TextareaField label="Notes" name="notes" bind:value={vNotes} rows={2} placeholder="Optional — batch, source, etc." />
			{#if vError}<p class="text-sm text-[var(--color-danger)]">{vError}</p>{/if}
			<Button type="submit" variant="primary" full class="w-full">Save {CONTAINER_FORM_LABELS[vForm].toLowerCase()}</Button>
		</form>
	</Modal>
{/if}
