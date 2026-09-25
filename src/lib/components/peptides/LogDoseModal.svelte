<script lang="ts">
	// The one dose form, used from the dashboard and the compound hub. Protocol-aware: picking a compound
	// selects its active protocol and prefills today's target dose (loading/taper aware), route, the best
	// open container and the next rotation site — so logging a planned dose is "open, check, save". Dose
	// can be typed in mg or mcg; a blend shows its live component split; side effects ride along.
	import { enhance } from '$app/forms';
	import { celebrate } from '$lib/utils/kitten';
	import { untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import NumberStepper from '$lib/components/NumberStepper.svelte';
	import TextareaField from '$lib/components/TextareaField.svelte';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import SitePicker from './SitePicker.svelte';
	import DoseAmountInput from './DoseAmountInput.svelte';
	import BlendBreakdown from './BlendBreakdown.svelte';
	import EffectsPicker from './EffectsPicker.svelte';
	import { nowHm, todayIso } from '$lib/utils/todayIso';
	import { syringeUnits } from '$lib/utils/reconstitution';
	import { mcgPerActuation, containerConcentrationMgMl, nostrilSplit } from '$lib/utils/delivery';
	import {
		ADMIN_ROUTES,
		formatDose,
		isInjectionRoute,
		defaultRouteForContainerForm,
		pickContainer,
		splitBlendDose,
		suggestNextSite,
		type AdminRoute,
		type ApplicationSite,
		type BlendComponent,
		type ContainerForm,
		type DoseEffect,
		type DoseKind,
		type MeasureUnit
	} from '$lib/utils/peptides';

	type CompoundOpt = {
		id: number;
		name: string;
		category: string | null;
		active: boolean;
		isBlend: boolean;
		components: BlendComponent[] | null;
	};
	type ProtocolOpt = {
		id: number;
		peptideId: number;
		label: string;
		route: AdminRoute | null;
		timeOfDay: string | null;
		rotateSites: boolean;
		targetMcg: number;
		mix: BlendComponent[] | null;
	};
	type VialOpt = {
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
		depleted: boolean;
		expiresAt: string | null;
		lastUsed: string | null;
	};
	type Initial = { peptideId?: number; protocolId?: number | null; doseMcg?: number | null } | null;
	/** An already-logged dose to edit in place, rather than logging a new one. */
	type Editing = {
		id: number;
		peptideId: number;
		protocolId: number | null;
		vialId: number | null;
		date: string;
		time: string | null;
		doseMcg: number;
		site: ApplicationSite | null;
		route: AdminRoute | null;
		measureCount: number | null;
		measureUnit: MeasureUnit | null;
		kind: DoseKind;
		notes: string | null;
		effects: DoseEffect[];
	};

	let {
		open = $bindable(false),
		compounds,
		protocols,
		vials,
		recentSites = [],
		initial = null,
		editing = null
	}: {
		open?: boolean;
		compounds: CompoundOpt[];
		protocols: ProtocolOpt[];
		vials: VialOpt[];
		recentSites?: { route: AdminRoute | null; site: ApplicationSite | null }[];
		initial?: Initial;
		editing?: Editing | null;
	} = $props();

	let peptideId = $state<number | null>(null);
	let protocolId = $state<number | null>(null);
	let date = $state(todayIso());
	let time = $state('');
	let doseMcg = $state<number | null>(null);
	let site = $state<ApplicationSite | null>(null);
	let route = $state<AdminRoute | ''>('');
	let vialId = $state<number | null>(null);
	let notes = $state('');
	let effects = $state<DoseEffect[]>([]);
	let error = $state('');
	/** Sprays for the intranasal branch — doseMcg is derived from it when the container's strength is known. */
	let sprayCount = $state(1);
	let isPrime = $state(false);
	/** Transdermal: applying vs. taking a patch off. */
	let isRemove = $state(false);
	/** Editing a skip: keep it a skip, or turn it into a real dose after all. */
	let isSkip = $state(false);
	let showMore = $state(false);

	const today = todayIso();

	function suggestSite(r: AdminRoute | '', rotate = true): ApplicationSite | null {
		if (!r || !rotate) return null;
		return suggestNextSite(r, recentSites.filter((h) => h.route === r).map((h) => h.site));
	}

	/** Prefill everything a protocol implies (or clear to a one-off dose when there's none). */
	function applyProtocol(id: number | null, compoundId: number, keepDose = false) {
		protocolId = id;
		const p = protocols.find((x) => x.id === id) ?? null;
		route = p?.route ?? '';
		if (!keepDose) doseMcg = p?.targetMcg ?? null;
		const container = pickContainer(vials, compoundId, route, today);
		vialId = container?.id ?? null;
		if (!route && container) route = defaultRouteForContainerForm(container.form);
		site = suggestSite(route, p?.rotateSites ?? true);
	}

	function applyCompound(id: number, preferredProtocolId: number | null = null, keepDose = false) {
		peptideId = id;
		const own = protocols.filter((p) => p.peptideId === id);
		const pick = own.find((p) => p.id === preferredProtocolId) ?? own[0] ?? null;
		applyProtocol(pick?.id ?? null, id, keepDose);
	}

	// Initialise once per opening (not on every prop refresh while open).
	let wasOpen = false;
	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) untrack(init);
		wasOpen = isOpen;
	});

	function init() {
		error = '';
		sprayCount = 1;
		isPrime = false;
		isRemove = false;
		isSkip = false;
		if (editing) {
			peptideId = editing.peptideId;
			protocolId = editing.protocolId;
			date = editing.date;
			time = editing.time ?? '';
			doseMcg = editing.doseMcg;
			site = editing.site;
			route = editing.route ?? '';
			vialId = editing.vialId;
			notes = editing.notes ?? '';
			effects = editing.effects.map((e) => ({ ...e }));
			sprayCount = editing.measureUnit === 'spray' ? (editing.measureCount ?? 1) : 1;
			isPrime = editing.kind === 'prime';
			isRemove = editing.kind === 'remove';
			isSkip = editing.kind === 'skip';
			showMore = effects.length > 0 || notes !== '';
			return;
		}
		date = today;
		time = nowHm();
		notes = '';
		effects = [];
		showMore = false;
		const firstActive = compounds.find((c) => c.active);
		const startId = initial?.peptideId ?? protocols[0]?.peptideId ?? firstActive?.id ?? null;
		if (startId == null) {
			peptideId = null;
			return;
		}
		applyCompound(startId, initial?.protocolId ?? null);
		if (initial?.doseMcg != null) doseMcg = initial.doseMcg;
	}

	const compound = $derived(compounds.find((c) => c.id === peptideId) ?? null);
	// Editing an old dose of a since-deactivated compound must still show (and resubmit) that compound.
	const compoundOptions = $derived(compounds.filter((c) => c.active || c.id === editing?.peptideId));
	const protocolOptions = $derived(protocols.filter((p) => p.peptideId === peptideId));
	const protocol = $derived(protocols.find((p) => p.id === protocolId) ?? null);
	// Likewise a since-depleted container the edited dose was drawn from.
	const containerOptions = $derived(vials.filter((v) => v.peptideId === peptideId && (!v.depleted || v.id === editing?.vialId)));
	const selectedContainer = $derived(containerOptions.find((v) => v.id === vialId) ?? null);
	const isInjection = $derived(isInjectionRoute(route));
	const isNasal = $derived(route === 'intranasal');
	const isTransdermal = $derived(route === 'transdermal');

	function selectContainer(id: number | null) {
		vialId = id;
		const container = containerOptions.find((v) => v.id === id) ?? null;
		const suggested = defaultRouteForContainerForm(container?.form);
		if (suggested) route = suggested; // 'vial' maps to '' (ambiguous subq/im) — leave the user's choice alone.
	}

	function containerLabel(v: VialOpt): string {
		const tags = `${v.depleted ? ' · used up' : ''}${v.expiresAt && v.expiresAt < today ? ' · expired' : ''}`;
		if (v.form === 'nasal_spray') {
			const conc = containerConcentrationMgMl(v);
			return `Nasal spray${conc != null ? ` · ${Math.round(conc * 100) / 100} mg/mL` : ''}${tags}`;
		}
		if (v.form === 'patches') {
			return `Patches${v.unitMassMcg != null ? ` · ${formatDose(v.unitMassMcg)}/patch` : ''}${v.unitCount != null ? ` · ${v.unitCount} in box` : ''}${tags}`;
		}
		return `${v.vialMg} mg${v.bacWaterMl ? ` in ${v.bacWaterMl} mL` : ''}${tags}`;
	}

	// --- Injection math ---
	const units = $derived(
		isInjection && selectedContainer?.form === 'vial' && selectedContainer.vialMg != null && selectedContainer.bacWaterMl && doseMcg
			? syringeUnits({ vialMg: selectedContainer.vialMg, bacWaterMl: selectedContainer.bacWaterMl, doseMcg })
			: null
	);

	// --- Nasal math: mg/mL x µL/spray ≡ mcg/spray (see $lib/utils/delivery.ts) ---
	const mcgPerSpray = $derived.by(() => {
		if (!isNasal || selectedContainer?.form !== 'nasal_spray' || !selectedContainer.actuationVolumeUl) return null;
		const conc = containerConcentrationMgMl(selectedContainer);
		if (conc == null) return null;
		const mpa = mcgPerActuation(conc, selectedContainer.actuationVolumeUl);
		return mpa > 0 ? mpa : null;
	});
	const nasalDoseMcg = $derived(mcgPerSpray != null ? Math.round(sprayCount * mcgPerSpray * 1000) / 1000 : null);
	const nostrilHint = $derived(site === 'nostril_both' && sprayCount > 1 ? nostrilSplit(sprayCount) : null);

	// --- Transdermal: a patch's dose is just its declared strength, whichever way (apply or remove). ---
	const patchDoseMcg = $derived(
		isTransdermal && selectedContainer?.form === 'patches' && selectedContainer.unitMassMcg != null ? selectedContainer.unitMassMcg : null
	);

	// Dose computed from sprays / patch strength (read-only) rather than typed.
	const computedDoseMcg = $derived(isNasal ? nasalDoseMcg : isTransdermal ? patchDoseMcg : null);
	const doseIsComputed = $derived(computedDoseMcg != null);
	const effectiveDose = $derived(doseIsComputed ? computedDoseMcg : doseMcg);

	// Blend: the split this dose will be recorded with — protocol mix, else the blend's default ratio.
	const mix = $derived(compound?.isBlend ? (protocol?.mix ?? compound.components) : null);
	const split = $derived(mix && effectiveDose && effectiveDose > 0 ? splitBlendDose(effectiveDose, mix) : null);

	const suggestedSite = $derived(suggestSite(route, protocol?.rotateSites ?? true));
	const targetHint = $derived(
		protocol && !editing && effectiveDose != null && Math.abs(effectiveDose - protocol.targetMcg) > 0.0005
			? `Protocol target today is ${formatDose(protocol.targetMcg)}`
			: null
	);

	// What actually gets submitted alongside doseMcg — the measured pair + dose/prime/remove/skip kind.
	const measureCount = $derived(isInjection ? units : isNasal ? sprayCount : isTransdermal ? 1 : null);
	const measureUnit = $derived<MeasureUnit | null>(isInjection && units != null ? 'unit' : isNasal ? 'spray' : isTransdermal ? 'patch' : null);
	const kind = $derived<DoseKind>(isSkip ? 'skip' : isNasal && isPrime ? 'prime' : isTransdermal && isRemove ? 'remove' : 'dose');

	const selectClass =
		'w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]';
</script>

<Modal bind:open title={editing ? 'Edit dose' : 'Log a dose'}>
	<form
		method="POST"
		action={editing ? '/peptides?/updateDose' : '/peptides?/logDose'}
		class="space-y-4"
		use:enhance={() => {
			error = '';
			return async ({ result, update }) => {
				if (result.type === 'success') {
					open = false;
					if (!editing) celebrate();
				}
				else if (result.type === 'failure')
					error = (result.data?.error as string) ?? (editing ? 'Could not update dose' : 'Could not log dose');
				await update({ reset: false });
			};
		}}
	>
		{#if editing}<input type="hidden" name="id" value={editing.id} />{/if}
		<input type="hidden" name="protocolId" value={protocolId ?? ''} />
		<input type="hidden" name="measureCount" value={measureCount ?? ''} />
		<input type="hidden" name="measureUnit" value={measureUnit ?? ''} />
		<input type="hidden" name="kind" value={kind} />

		{#if compoundOptions.length === 0}
			<p class="text-sm text-[var(--color-text-muted)]">
				Add a compound first under <a href="/peptides/manage" class="text-[var(--color-accent)]">Manage</a>.
			</p>
		{/if}

		<div class="grid grid-cols-1 gap-3 {protocolOptions.length > 0 ? 'sm:grid-cols-2' : ''}">
			<div>
				<label for="dose-peptide" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Compound</label>
				<select
					id="dose-peptide"
					name="peptideId"
					value={peptideId}
					onchange={(e) => applyCompound(Number((e.currentTarget as HTMLSelectElement).value))}
					class={selectClass}
				>
					{#each compoundOptions as c (c.id)}
						<option value={c.id}>{c.name}{c.isBlend ? ' (blend)' : ''}{c.active ? '' : ' (inactive)'}</option>
					{/each}
				</select>
			</div>
			{#if protocolOptions.length > 0}
				<div>
					<label for="dose-protocol" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Protocol</label>
					<select
						id="dose-protocol"
						value={protocolId ?? ''}
						onchange={(e) => {
							const v = Number((e.currentTarget as HTMLSelectElement).value);
							if (peptideId != null) applyProtocol(v > 0 ? v : null, peptideId, !!editing);
						}}
						class={selectClass}
					>
						{#each protocolOptions as p (p.id)}
							<option value={p.id}>{p.label}{p.timeOfDay ? ` · ${p.timeOfDay}` : ''}</option>
						{/each}
						<option value="">One-off (no protocol)</option>
					</select>
				</div>
			{/if}
		</div>

		{#if editing && editing.kind === 'skip'}
			<div class="flex gap-1.5">
				<Chip selected={isSkip} onclick={() => (isSkip = true)}>Skipped</Chip>
				<Chip selected={!isSkip} onclick={() => (isSkip = false)}>Actually taken</Chip>
			</div>
		{/if}

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="dose-date" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Date</label>
				<input id="dose-date" type="date" name="date" bind:value={date} max={today} class={selectClass} />
			</div>
			<div>
				<label for="dose-time" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Time</label>
				<input id="dose-time" type="time" name="time" bind:value={time} class={selectClass} />
			</div>
		</div>

		{#if !isSkip}
			<div class="grid grid-cols-2 gap-3">
				{#if doseIsComputed}
					<div>
						<span class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Dose</span>
						<div
							class="h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface-alt)] text-[var(--color-text)] flex items-center justify-between text-sm tabular-nums"
						>
							<span>{formatDose(computedDoseMcg)}</span>
							<span class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">{isNasal ? 'from sprays' : 'per patch'}</span>
						</div>
						<input type="hidden" name="doseMcg" value={computedDoseMcg ?? ''} />
					</div>
				{:else}
					<DoseAmountInput bind:value={doseMcg} preferMg={!!compound && (compound.isBlend || compound.category === 'glp1')} />
				{/if}
				<div>
					<label for="dose-route" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Route</label>
					<select id="dose-route" name="route" bind:value={route} class={selectClass}>
						<option value="">—</option>
						{#each ADMIN_ROUTES as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
					</select>
				</div>
			</div>
			{#if targetHint}<p class="-mt-2 text-xs text-[var(--color-text-muted)]">{targetHint}</p>{/if}

			{#if split}
				<div class="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3.5 py-2.5">
					<p class="text-xs font-medium text-[var(--color-text)] mb-0.5">
						{formatDose(effectiveDose)} of {compound?.name} is recorded as
					</p>
					<BlendBreakdown portions={split} />
				</div>
			{/if}

			{#if containerOptions.length > 0}
				<div>
					<label for="dose-vial" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Container</label>
					<select
						id="dose-vial"
						name="vialId"
						value={vialId ?? ''}
						onchange={(e) => selectContainer(Number((e.currentTarget as HTMLSelectElement).value) || null)}
						class={selectClass}
					>
						<option value="">—</option>
						{#each containerOptions as v (v.id)}
							<option value={v.id}>{containerLabel(v)}</option>
						{/each}
					</select>
					{#if isInjection && units != null}
						<p class="mt-1.5 text-xs text-[var(--color-accent)] tabular-nums">≈ {units} units on a U-100 syringe</p>
					{/if}
				</div>
			{/if}

			{#if isInjection}
				<div>
					<p class="section-label mb-2">Injection site</p>
					<SitePicker bind:value={site} {route} suggested={suggestedSite} />
				</div>
			{:else if isNasal}
				<div class="space-y-3">
					<div class="flex items-end gap-3">
						<NumberStepper label="Sprays" bind:value={sprayCount} step={1} min={0} class="max-w-[160px]" />
						<div class="flex-1 text-sm text-[var(--color-text-muted)] pb-2.5">
							{#if mcgPerSpray != null}
								≈ {formatDose(nasalDoseMcg)}{#if nostrilHint}{' · '}{nostrilHint[0]} L / {nostrilHint[1]} R{/if}
							{:else}
								Select a nasal spray container above to auto-calculate mcg.
							{/if}
						</div>
					</div>
					<div>
						<p class="section-label mb-2">Nostril</p>
						<SitePicker bind:value={site} route="intranasal" suggested={suggestedSite} />
					</div>
					<label class="flex items-center gap-2.5 text-sm text-[var(--color-text)]">
						<input type="checkbox" bind:checked={isPrime} class="h-4 w-4 accent-[var(--color-accent)]" />
						Priming spray — doesn't count toward adherence
					</label>
				</div>
			{:else if isTransdermal}
				<div class="space-y-3">
					<div class="flex gap-1.5">
						<Chip selected={!isRemove} onclick={() => (isRemove = false)}>Applied</Chip>
						<Chip selected={isRemove} onclick={() => (isRemove = true)}>Removed</Chip>
					</div>
					{#if patchDoseMcg == null}
						<p class="text-xs text-[var(--color-text-muted)]">Select a patch container above, or enter the dose manually.</p>
					{/if}
					<div>
						<p class="section-label mb-2">Placement</p>
						<SitePicker bind:value={site} route="transdermal" suggested={suggestedSite} />
					</div>
				</div>
			{/if}
		{:else}
			<input type="hidden" name="doseMcg" value="0" />
		{/if}

		{#if showMore}
			<div class="space-y-3">
				{#if !isSkip}
					<div>
						<p class="section-label mb-2">How did it go?</p>
						<EffectsPicker bind:value={effects} />
					</div>
				{:else}
					<input type="hidden" name="effects" value="[]" />
				{/if}
				<TextareaField label="Notes" name="notes" bind:value={notes} rows={2} placeholder="Optional — how you felt, anything unusual" />
			</div>
		{:else}
			<input type="hidden" name="effects" value={JSON.stringify(effects)} />
			<input type="hidden" name="notes" value={notes} />
			<button type="button" onclick={() => (showMore = true)} class="text-sm text-[var(--color-accent)] font-medium">
				+ Side effects & notes
			</button>
		{/if}

		{#if error}<p class="text-sm text-[var(--color-danger)]">{error}</p>{/if}
		<Button type="submit" variant="primary" full class="w-full" disabled={peptideId == null}>
			{editing ? 'Save changes' : isSkip ? 'Save skip' : 'Log dose'}
		</Button>
	</form>
</Modal>
