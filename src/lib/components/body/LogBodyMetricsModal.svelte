<script lang="ts">
	import { enhance } from '$app/forms';
	import { celebrate } from '$lib/utils/kitten';
	import Modal from '$lib/components/Modal.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import TextareaField from '$lib/components/TextareaField.svelte';
	import Button from '$lib/components/Button.svelte';
	import { todayIso } from '$lib/utils/todayIso';
	import { cmToDisplay, kgToDisplay, round1, type LengthUnit, type WeightUnit } from '$lib/utils/units';

	type InitialMetric = {
		date: string;
		weightKg: number | null;
		bodyFatPct: number | null;
		notes: string | null;
		neckCm: number | null;
		chestCm: number | null;
		waistCm: number | null;
		hipsCm: number | null;
		thighCm: number | null;
		armCm: number | null;
		calfCm: number | null;
	} | null;

	let {
		open = $bindable(false),
		settings,
		initial = null
	}: {
		open?: boolean;
		settings: { weightUnit: WeightUnit; lengthUnit: LengthUnit };
		initial?: InitialMetric;
	} = $props();

	const LENGTHS = [
		{ key: 'neck', label: 'Neck' },
		{ key: 'chest', label: 'Chest' },
		{ key: 'waist', label: 'Waist' },
		{ key: 'hips', label: 'Hips' },
		{ key: 'thigh', label: 'Thigh' },
		{ key: 'arm', label: 'Arm' },
		{ key: 'calf', label: 'Calf' }
	] as const;

	let date = $state(todayIso());
	let weight = $state<number | null>(null);
	let bodyFat = $state<number | null>(null);
	// Seed every measurement key to null up-front: the fields render (and bind) the moment the modal
	// opens, before the seeding $effect below runs, and binding `undefined` to NumberField's `value`
	// (which has a null fallback) throws Svelte's props_invalid_value and aborts the render.
	let lengths = $state<Record<string, number | null>>(Object.fromEntries(LENGTHS.map(({ key }) => [key, null])));
	let notes = $state('');
	let error = $state('');

	function initialCm(): Record<string, number | null> {
		if (!initial) return {};
		return {
			neck: initial.neckCm,
			chest: initial.chestCm,
			waist: initial.waistCm,
			hips: initial.hipsCm,
			thigh: initial.thighCm,
			arm: initial.armCm,
			calf: initial.calfCm
		};
	}

	// Seed the fields (converting canonical kg/cm → the user's display unit) each time the sheet opens.
	$effect(() => {
		if (!open) return;
		date = initial?.date ?? todayIso();
		weight = initial?.weightKg != null ? round1(kgToDisplay(initial.weightKg, settings.weightUnit)) : null;
		bodyFat = initial?.bodyFatPct ?? null;
		const cm = initialCm();
		const seeded: Record<string, number | null> = {};
		for (const { key } of LENGTHS) seeded[key] = cm[key] != null ? round1(cmToDisplay(cm[key]!, settings.lengthUnit)) : null;
		lengths = seeded;
		notes = initial?.notes ?? '';
		error = '';
	});
</script>

<Modal bind:open title="Log body metrics">
	<form
		method="POST"
		action="/body?/logMetrics"
		class="space-y-4"
		use:enhance={() => {
			error = '';
			return async ({ result, update }) => {
				if (result.type === 'success') {
					open = false;
					celebrate();
				}
				else if (result.type === 'failure') error = (result.data?.error as string) ?? 'Could not save';
				await update({ reset: false });
			};
		}}
	>
		<div>
			<label for="metric-date" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Date</label>
			<input
				id="metric-date"
				type="date"
				name="date"
				bind:value={date}
				max={todayIso()}
				class="w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
			/>
		</div>

		<div class="grid grid-cols-2 gap-3">
			<NumberField label="Weight" name="weight" bind:value={weight} decimalText suffix={settings.weightUnit} />
			<NumberField label="Body fat" name="bodyFat" bind:value={bodyFat} decimalText suffix="%" />
		</div>

		<div>
			<p class="section-label mb-2">Measurements ({settings.lengthUnit})</p>
			<div class="grid grid-cols-2 gap-3">
				{#each LENGTHS as m (m.key)}
					<NumberField label={m.label} name={m.key} bind:value={lengths[m.key]} decimalText suffix={settings.lengthUnit} />
				{/each}
			</div>
		</div>

		<TextareaField label="Notes" name="notes" bind:value={notes} rows={2} placeholder="Optional — how you felt, conditions, etc." />

		{#if error}
			<p class="text-sm text-[var(--color-danger)]">{error}</p>
		{/if}
		<p class="text-xs text-[var(--color-text-muted)]">Only the fields you fill in are saved. Leaving one blank keeps any value already logged for that day.</p>
		<Button type="submit" variant="primary" full class="w-full">Save</Button>
	</form>
</Modal>
