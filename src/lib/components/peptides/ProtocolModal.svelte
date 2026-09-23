<script lang="ts">
	// Add/edit a protocol: dose (mg or mcg) + schedule — every day / every other day / every N days /
	// specific weekdays / N per week, optionally several doses a day — with optional loading and taper
	// phases, a cycle, and (for a blend) a mix specific to this protocol's vials.
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import TextareaField from '$lib/components/TextareaField.svelte';
	import Button from '$lib/components/Button.svelte';
	import DoseAmountInput from './DoseAmountInput.svelte';
	import BlendMixEditor from './BlendMixEditor.svelte';
	import BlendBreakdown from './BlendBreakdown.svelte';
	import { todayIso } from '$lib/utils/todayIso';
	import { ADMIN_ROUTES, formatDose, splitBlendDose, type AdminRoute, type BlendComponent } from '$lib/utils/peptides';
	import { FREQUENCY_LABELS, type Frequency } from '$lib/utils/peptideSchedule';

	type CompoundOpt = { id: number; name: string; active: boolean; isBlend: boolean; components: BlendComponent[] | null; vialMg: number | null };
	type Protocol = {
		id: number;
		peptideId: number;
		doseMcg: number;
		route: AdminRoute | null;
		frequency: Frequency;
		weekdayMask: number | null;
		perWeek: number | null;
		intervalDays: number | null;
		timesPerDay: number;
		timeOfDay: string | null;
		startDate: string;
		endDate: string | null;
		cycleWeeksOn: number | null;
		cycleWeeksOff: number | null;
		rotateSites: boolean;
		notes: string | null;
		loadingDoseMcg: number | null;
		loadingDurationDays: number | null;
		taperDoseMcg: number | null;
		taperAfterDays: number | null;
		components: BlendComponent[] | null;
	};

	let {
		open = $bindable(false),
		compounds,
		protocol = null,
		defaultPeptideId = null
	}: { open?: boolean; compounds: CompoundOpt[]; protocol?: Protocol | null; defaultPeptideId?: number | null } = $props();

	const WEEKDAYS = [
		{ d: 1, label: 'Mo' },
		{ d: 2, label: 'Tu' },
		{ d: 3, label: 'We' },
		{ d: 4, label: 'Th' },
		{ d: 5, label: 'Fr' },
		{ d: 6, label: 'Sa' },
		{ d: 0, label: 'Su' }
	];

	let peptideId = $state<number | null>(null);
	let dose = $state<number | null>(null);
	let route = $state('');
	let freq = $state<Frequency>('daily');
	let days = $state<Set<number>>(new Set());
	let perWeek = $state<number | null>(null);
	let intervalDays = $state<number | null>(3);
	let timesPerDay = $state<number | null>(1);
	let time = $state('');
	let start = $state(todayIso());
	let end = $state('');
	let on = $state<number | null>(null);
	let off = $state<number | null>(null);
	let rotate = $state(true);
	let notes = $state('');
	let loading = $state(false);
	let loadDose = $state<number | null>(null);
	let loadDays = $state<number | null>(null);
	let taper = $state(false);
	let taperDose = $state<number | null>(null);
	let taperAfter = $state<number | null>(null);
	let customMix = $state(false);
	let mixKey = $state(0);
	let mixInitial = $state<BlendComponent[]>([]);
	let error = $state('');

	let wasOpen = false;
	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) untrack(init);
		wasOpen = isOpen;
	});
	function init() {
		const p = protocol;
		peptideId = p?.peptideId ?? defaultPeptideId ?? compounds.find((c) => c.active)?.id ?? null;
		dose = p?.doseMcg ?? null;
		route = p?.route ?? '';
		freq = p?.frequency ?? 'daily';
		days = new Set(WEEKDAYS.map((w) => w.d).filter((d) => ((p?.weekdayMask ?? 0) & (1 << d)) !== 0));
		perWeek = p?.perWeek ?? null;
		intervalDays = p?.intervalDays ?? 3;
		timesPerDay = p?.timesPerDay ?? 1;
		time = p?.timeOfDay ?? '';
		start = p?.startDate ?? todayIso();
		end = p?.endDate ?? '';
		on = p?.cycleWeeksOn ?? null;
		off = p?.cycleWeeksOff ?? null;
		rotate = p?.rotateSites ?? true;
		notes = p?.notes ?? '';
		loading = p?.loadingDoseMcg != null && p?.loadingDurationDays != null;
		loadDose = p?.loadingDoseMcg ?? null;
		loadDays = p?.loadingDurationDays ?? null;
		taper = p?.taperDoseMcg != null && p?.taperAfterDays != null;
		taperDose = p?.taperDoseMcg ?? null;
		taperAfter = p?.taperAfterDays ?? null;
		customMix = (p?.components?.length ?? 0) > 0;
		resetMix(p?.components ?? null);
		error = '';
	}

	const compound = $derived(compounds.find((c) => c.id === peptideId) ?? null);

	function resetMix(from: BlendComponent[] | null) {
		mixInitial = from && from.length > 0 ? from : (compound?.components ?? []);
		mixKey++;
	}
	function onCompoundChange(e: Event) {
		peptideId = Number((e.currentTarget as HTMLSelectElement).value);
		customMix = false;
		resetMix(null);
	}
	function toggleDay(d: number) {
		const next = new Set(days);
		if (next.has(d)) next.delete(d);
		else next.add(d);
		days = next;
	}

	const defaultSplit = $derived(
		compound?.isBlend && compound.components && dose && dose > 0 ? splitBlendDose(dose, compound.components) : null
	);
	const inputClass =
		'w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]';
</script>

<Modal bind:open title={protocol ? 'Edit protocol' : 'Add protocol'}>
	<form
		method="POST"
		action="/peptides/manage?/saveProtocol"
		class="space-y-4"
		use:enhance={() => async ({ result, update }) => {
			if (result.type === 'success') open = false;
			else if (result.type === 'failure') error = String(result.data?.error ?? 'Could not save');
			await update({ reset: false });
		}}
	>
		<input type="hidden" name="id" value={protocol?.id ?? ''} />
		<input type="hidden" name="rotateSites" value={rotate ? 'on' : ''} />
		<div>
			<label for="pr-pep" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Compound</label>
			<select id="pr-pep" name="peptideId" value={peptideId} onchange={onCompoundChange} class={inputClass}>
				{#each compounds.filter((c) => c.active || c.id === protocol?.peptideId) as c (c.id)}
					<option value={c.id}>{c.name}{c.isBlend ? ' (blend)' : ''}</option>
				{/each}
			</select>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<DoseAmountInput label="Dose" name="doseMcg" id="pr-dose" bind:value={dose} />
			<div>
				<label for="pr-route" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Route</label>
				<select id="pr-route" name="route" bind:value={route} class={inputClass}>
					<option value="">—</option>
					{#each ADMIN_ROUTES as r (r.value)}<option value={r.value}>{r.label}</option>{/each}
				</select>
			</div>
		</div>

		{#if compound?.isBlend}
			<div class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3.5 py-2.5">
				<p class="text-sm font-medium text-[var(--color-text)]">Blend mix</p>
				{#if !customMix}
					{#if defaultSplit}
						<p class="text-xs text-[var(--color-text-muted)] mt-1">Each {formatDose(dose)} dose is recorded as</p>
						<BlendBreakdown portions={defaultSplit} />
					{:else}
						<p class="text-xs text-[var(--color-text-muted)] mt-1">Uses {compound.name}'s default mix.</p>
					{/if}
				{/if}
				<label class="mt-2 flex items-center gap-2.5 text-sm text-[var(--color-text)]">
					<input type="checkbox" name="customMix" bind:checked={customMix} class="h-4 w-4 accent-[var(--color-accent)]" />
					My vials have a different mix
				</label>
				{#if customMix}
					<div class="mt-3">
						{#key mixKey}
							<BlendMixEditor initial={mixInitial} vialMg={compound.vialMg} previewDoseMcg={dose} showPresets={false} />
						{/key}
					</div>
				{/if}
			</div>
		{/if}

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="pr-freq" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Frequency</label>
				<select id="pr-freq" name="frequency" bind:value={freq} class={inputClass}>
					{#each Object.entries(FREQUENCY_LABELS) as [value, label] (value)}<option {value}>{label}</option>{/each}
				</select>
			</div>
			{#if freq === 'x_per_week'}
				<NumberField label="Doses per week" name="perWeek" bind:value={perWeek} suffix="×/wk" />
			{:else}
				<NumberField label="Doses per day" name="timesPerDay" bind:value={timesPerDay} min={1} suffix="×/day" />
			{/if}
		</div>
		{#if freq === 'weekly'}
			<div>
				<p class="section-label mb-2">Days</p>
				<div class="flex gap-1.5">
					{#each WEEKDAYS as w (w.d)}
						{@const sel = days.has(w.d)}
						<button
							type="button"
							onclick={() => toggleDay(w.d)}
							class={`flex-1 h-10 rounded-[var(--radius-md)] border text-sm ${sel ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)] font-medium' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
						>
							{w.label}
						</button>
					{/each}
				</div>
				{#each [...days] as d (d)}<input type="hidden" name="weekday" value={d} />{/each}
				<p class="mt-1.5 text-xs text-[var(--color-text-muted)]">Tip: Mo–Fr gives a 5-on / 2-off week.</p>
			</div>
		{:else if freq === 'every_n_days'}
			<NumberField label="Every how many days?" name="intervalDays" bind:value={intervalDays} min={2} suffix="days" />
		{/if}

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="pr-start" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Start</label>
				<input id="pr-start" type="date" name="startDate" bind:value={start} class={inputClass} />
			</div>
			<div>
				<label for="pr-time" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Time of day</label>
				<input id="pr-time" name="timeOfDay" bind:value={time} placeholder={timesPerDay && timesPerDay > 1 ? 'e.g. AM & PM' : 'e.g. AM'} class={inputClass} />
			</div>
		</div>

		<div class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3.5 py-2.5">
			<label class="flex items-center gap-2.5 text-sm text-[var(--color-text)]">
				<input type="checkbox" bind:checked={loading} class="h-4 w-4 accent-[var(--color-accent)]" />
				Use a loading phase
			</label>
			{#if loading}
				<p class="text-xs text-[var(--color-text-muted)] mt-1.5 mb-3">
					A different dose for the first stretch of the protocol, on the same schedule, before it drops to the dose above.
				</p>
				<div class="grid grid-cols-2 gap-3">
					<DoseAmountInput label="Loading dose" name="loadingDoseMcg" id="pr-load-dose" bind:value={loadDose} />
					<NumberField label="For" name="loadingDurationDays" bind:value={loadDays} suffix="days" />
				</div>
			{:else}
				<input type="hidden" name="loadingDoseMcg" value="" />
				<input type="hidden" name="loadingDurationDays" value="" />
			{/if}
		</div>
		<details class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3.5 py-2.5">
			<summary class="text-sm text-[var(--color-text-muted)] cursor-pointer select-none">Cycle, taper & more</summary>
			<div class="mt-3 space-y-3">
				<div class="grid grid-cols-2 gap-3">
					<NumberField label="Weeks on" name="cycleWeeksOn" bind:value={on} suffix="wk" />
					<NumberField label="Weeks off" name="cycleWeeksOff" bind:value={off} suffix="wk" />
				</div>
				<div>
					<label for="pr-end" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">End date (optional)</label>
					<input id="pr-end" type="date" name="endDate" bind:value={end} class={inputClass} />
				</div>
				<label class="flex items-center gap-2.5 text-sm text-[var(--color-text)]">
					<input type="checkbox" bind:checked={rotate} class="h-4 w-4 accent-[var(--color-accent)]" />
					Suggest rotating injection sites
				</label>
				<div class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3.5 py-2.5">
					<label class="flex items-center gap-2.5 text-sm text-[var(--color-text)]">
						<input type="checkbox" bind:checked={taper} class="h-4 w-4 accent-[var(--color-accent)]" />
						Use a taper phase
					</label>
					{#if taper}
						<p class="text-xs text-[var(--color-text-muted)] mt-1.5 mb-3">
							A third dose that takes over after a stretch at the regular dose — runs through the end date if set, or
							indefinitely.
						</p>
						<div class="grid grid-cols-2 gap-3">
							<DoseAmountInput label="Taper dose" name="taperDoseMcg" id="pr-taper-dose" bind:value={taperDose} />
							<NumberField label="Starts after" name="taperAfterDays" bind:value={taperAfter} suffix="days" />
						</div>
					{:else}
						<input type="hidden" name="taperDoseMcg" value="" />
						<input type="hidden" name="taperAfterDays" value="" />
					{/if}
				</div>
				<TextareaField label="Notes" name="notes" bind:value={notes} rows={2} placeholder="Optional" />
			</div>
		</details>
		{#if error}<p class="text-sm text-[var(--color-danger)]">{error}</p>{/if}
		<Button type="submit" variant="primary" full class="w-full">Save protocol</Button>
	</form>
</Modal>
