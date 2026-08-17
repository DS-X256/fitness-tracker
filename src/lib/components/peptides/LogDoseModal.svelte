<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import NumberStepper from '$lib/components/NumberStepper.svelte';
	import TextareaField from '$lib/components/TextareaField.svelte';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import SitePicker from './SitePicker.svelte';
	import { todayIso } from '$lib/utils/todayIso';
	import { syringeUnits } from '$lib/utils/reconstitution';
	import { mcgPerActuation, containerConcentrationMgMl, nostrilSplit } from '$lib/utils/delivery';
	import {
		ADMIN_ROUTES,
		formatDose,
		isInjectionRoute,
		defaultRouteForContainerForm,
		suggestNextSite,
		type AdminRoute,
		type ApplicationSite,
		type ContainerForm,
		type MeasureUnit
	} from '$lib/utils/peptides';

	type PeptideOpt = { id: number; name: string; vialMg: number | null };
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
	};
	type Initial = { peptideId?: number; doseMcg?: number | null; protocolId?: number | null } | null;

	let {
		open = $bindable(false),
		peptides,
		vials,
		recentSites = [],
		initial = null
	}: {
		open?: boolean;
		peptides: PeptideOpt[];
		vials: VialOpt[];
		recentSites?: { route: AdminRoute | null; site: ApplicationSite | null }[];
		initial?: Initial;
	} = $props();

	let peptideId = $state<number | null>(null);
	let date = $state(todayIso());
	let doseMcg = $state<number | null>(null);
	let site = $state<ApplicationSite | null>(null);
	let route = $state<AdminRoute | ''>('');
	let vialId = $state<number | null>(null);
	let time = $state('');
	let notes = $state('');
	let error = $state('');
	/** Sprays for the intranasal branch — the primary "what you did" input; doseMcg is derived from it
	 *  when the selected container's concentration is known (see the sync effect below). */
	let sprayCount = $state(1);
	let isPrime = $state(false);
	/** Transdermal: applying vs. taking a patch off — mutually exclusive, unlike the prime checkbox
	 *  above which is a modifier on top of a normal dose. */
	let isRemove = $state(false);

	$effect(() => {
		if (!open) return;
		peptideId = initial?.peptideId ?? peptides[0]?.id ?? null;
		date = todayIso();
		doseMcg = initial?.doseMcg ?? null;
		site = null;
		route = '';
		vialId = null;
		time = '';
		notes = '';
		error = '';
		sprayCount = 1;
		isPrime = false;
		isRemove = false;
	});

	const containersForPeptide = $derived(vials.filter((v) => v.peptideId === peptideId));
	const selectedContainer = $derived(containersForPeptide.find((v) => v.id === vialId) ?? null);
	const isInjection = $derived(isInjectionRoute(route));
	const isNasal = $derived(route === 'intranasal');
	const isTransdermal = $derived(route === 'transdermal');

	function selectContainer(id: number | null) {
		vialId = id;
		const container = containersForPeptide.find((v) => v.id === id) ?? null;
		const suggested = defaultRouteForContainerForm(container?.form);
		if (suggested) route = suggested; // 'vial' maps to '' (ambiguous subq/im) — leave the user's choice alone.
	}

	function containerLabel(v: VialOpt): string {
		if (v.form === 'nasal_spray') {
			const conc = containerConcentrationMgMl(v);
			return `Nasal spray${conc != null ? ` · ${Math.round(conc * 100) / 100} mg/mL` : ''}`;
		}
		if (v.form === 'patches') {
			return `Patches${v.unitMassMcg != null ? ` · ${formatDose(v.unitMassMcg)}/patch` : ''}${v.unitCount != null ? ` · ${v.unitCount} in box` : ''}`;
		}
		return `${v.vialMg} mg${v.bacWaterMl ? ` in ${v.bacWaterMl} mL` : ''}`;
	}

	// --- Injection math (unchanged from before route-awareness existed) ---
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
		isTransdermal && selectedContainer?.form === 'patches' && selectedContainer.unitMassMcg != null
			? selectedContainer.unitMassMcg
			: null
	);

	// Whether the Dose field is computed (read-only) rather than manually typed. NOT done by writing into
	// `doseMcg` and letting NumberField display it — NumberField's visible text only follows the user's
	// own typing (by design, see NumberStepper.svelte), so a programmatic write would update the
	// submitted value but leave the box looking blank. A dedicated read-only row avoids that.
	const computedDoseMcg = $derived(isNasal ? nasalDoseMcg : isTransdermal ? patchDoseMcg : null);
	const doseIsComputed = $derived(computedDoseMcg != null);

	const suggestedSite = $derived(
		route ? suggestNextSite(route, recentSites.filter((r) => r.route === route).map((r) => r.site)) : null
	);

	// What actually gets submitted alongside doseMcg — the measured pair + dose/prime/remove kind.
	const measureCount = $derived(isInjection ? units : isNasal ? sprayCount : isTransdermal ? 1 : null);
	const measureUnit = $derived<MeasureUnit | null>(
		isInjection && units != null ? 'unit' : isNasal ? 'spray' : isTransdermal ? 'patch' : null
	);
	const kind = $derived(isNasal && isPrime ? 'prime' : isTransdermal && isRemove ? 'remove' : 'dose');
</script>

<Modal bind:open title="Log a dose">
	<form
		method="POST"
		action="/peptides?/logDose"
		class="space-y-4"
		use:enhance={() => {
			error = '';
			return async ({ result, update }) => {
				if (result.type === 'success') open = false;
				else if (result.type === 'failure') error = (result.data?.error as string) ?? 'Could not log dose';
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="protocolId" value={initial?.protocolId ?? ''} />
		<input type="hidden" name="measureCount" value={measureCount ?? ''} />
		<input type="hidden" name="measureUnit" value={measureUnit ?? ''} />
		<input type="hidden" name="kind" value={kind} />

		<div>
			<label for="dose-peptide" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Peptide</label>
			<select
				id="dose-peptide"
				name="peptideId"
				bind:value={peptideId}
				class="w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
			>
				{#each peptides as p (p.id)}
					<option value={p.id}>{p.name}</option>
				{/each}
			</select>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="dose-date" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Date</label>
				<input
					id="dose-date"
					type="date"
					name="date"
					bind:value={date}
					max={todayIso()}
					class="w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
				/>
			</div>
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
				<NumberField label="Dose" name="doseMcg" bind:value={doseMcg} decimalText suffix="mcg" />
			{/if}
		</div>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="dose-route" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Route</label>
				<select
					id="dose-route"
					name="route"
					bind:value={route}
					class="w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
				>
					<option value="">—</option>
					{#each ADMIN_ROUTES as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
				</select>
			</div>
			<div>
				<label for="dose-time" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Time</label>
				<input
					id="dose-time"
					type="time"
					name="time"
					bind:value={time}
					class="w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
				/>
			</div>
		</div>

		{#if containersForPeptide.length > 0}
			<div>
				<label for="dose-vial" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Container (optional)</label>
				<select
					id="dose-vial"
					name="vialId"
					value={vialId}
					onchange={(e) => selectContainer(Number((e.currentTarget as HTMLSelectElement).value) || null)}
					class="w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
				>
					<option value={null}>—</option>
					{#each containersForPeptide as v (v.id)}
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
				<SitePicker bind:value={site} route={route} suggested={suggestedSite} />
			</div>
		{:else if isNasal}
			<div class="space-y-3">
				<div class="flex items-end gap-3">
					<NumberStepper label="Sprays" bind:value={sprayCount} step={1} min={0} class="max-w-[160px]" />
					<div class="flex-1 text-sm text-[var(--color-text-muted)] pb-2.5">
						{#if mcgPerSpray != null}
							≈ {formatDose(nasalDoseMcg)}{#if nostrilHint} · {nostrilHint[0]} L / {nostrilHint[1]} R{/if}
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

		<TextareaField label="Notes" name="notes" bind:value={notes} rows={2} placeholder="Optional — effects, side effects, etc." />

		{#if error}<p class="text-sm text-[var(--color-danger)]">{error}</p>{/if}
		<Button type="submit" variant="primary" full class="w-full">Log dose</Button>
	</form>
</Modal>
