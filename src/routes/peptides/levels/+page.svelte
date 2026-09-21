<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import LevelChart from '$lib/components/peptides/LevelChart.svelte';
	import { activeAmountMcg, formatHalfLife, levelParts, levelSeries } from '$lib/utils/peptides';
	import { daysBetween } from '$lib/utils/peptideSchedule';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const DAY_MS = 86_400_000;
	const RANGES = [
		{ value: 'week', label: 'Week', days: 7 },
		{ value: 'month', label: 'Month', days: 30 },
		{ value: '90d', label: '90 days', days: 90 },
		{ value: 'all', label: 'All time', days: null }
	] as const;

	// Null means "no explicit pick yet" — `compound` below falls back to the first one.
	let selectedId = $state<number | null>(null);
	let range = $state<(typeof RANGES)[number]['value']>('month');

	const compound = $derived(data.compounds.find((c) => c.id === selectedId) ?? data.compounds[0] ?? null);

	const fromMs = $derived.by(() => {
		if (!compound) return 0;
		const days = RANGES.find((r) => r.value === range)?.days ?? null;
		if (days != null) return data.nowMs - days * DAY_MS;
		// All time: start a day before the first dose so the curve doesn't begin mid-spike.
		const first = compound.doses[0]?.date;
		const firstMs = first ? new Date(`${first}T12:00:00`).getTime() - DAY_MS : data.nowMs - 30 * DAY_MS;
		return Math.min(firstMs, data.nowMs - DAY_MS);
	});

	const points = $derived(compound ? levelSeries(compound.doses, compound.halfLifeHours, fromMs, data.nowMs) : []);
	const activeNow = $derived(
		compound ? activeAmountMcg(compound.doses, compound.halfLifeHours, new Date(data.nowMs)) : 0
	);

	const daysToNext = $derived(compound?.nextDue ? daysBetween(data.today, compound.nextDue) : null);

	/** How far through the gap between the last dose and the next one we are, for the countdown ring. */
	const ringFraction = $derived.by(() => {
		if (!compound?.lastDoseDate || !compound.nextDue) return 0;
		const total = daysBetween(compound.lastDoseDate, compound.nextDue);
		if (total <= 0) return 1;
		const elapsed = daysBetween(compound.lastDoseDate, data.today);
		return Math.min(1, Math.max(0, elapsed / total));
	});

	const RING_R = 52;
	const RING_C = 2 * Math.PI * RING_R;

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });
	}
</script>

<svelte:head><title>Estimated levels · Fitness Tracker</title></svelte:head>

<PageHeader title="Levels" back="/peptides" />

<div class="mx-auto max-w-md px-4 pb-8 space-y-5">
	{#if !data.encryptionReady}
		<Card><p class="text-sm text-[var(--color-text-muted)]">Set <code>PHOTO_ENCRYPTION_KEY</code> to enable peptide tracking.</p></Card>
	{:else if !compound}
		<Card>
			<div class="flex items-start gap-3">
				<div class="mt-0.5 shrink-0 text-[var(--color-text-muted)]"><Icon name="chart" size={20} /></div>
				<div class="text-sm leading-relaxed">
					<p class="text-[var(--color-text)] font-medium">Nothing to estimate yet</p>
					<p class="mt-1 text-[var(--color-text-muted)]">
						This screen plots how much of a compound is still in your system, decaying from each dose you've
						logged. It needs a compound with a half-life on file and at least one logged dose —
						<a href="/peptides/manage" class="text-[var(--color-accent)]">set a half-life</a> to get started.
					</p>
				</div>
			</div>
		</Card>
	{:else}
		{#if data.compounds.length > 1}
			<div class="flex gap-1.5 overflow-x-auto pb-1 -mx-1 px-1">
				{#each data.compounds as c (c.id)}
					<Chip selected={c.id === compound.id} onclick={() => (selectedId = c.id)}>{c.name}</Chip>
				{/each}
			</div>
		{/if}

		{@const last = levelParts(compound.lastDoseMcg)}
		{@const now = levelParts(activeNow)}
		<div class="grid grid-cols-3 gap-2">
			<StatCard label="Doses logged" value={compound.doseCount} />
			<StatCard label="Last dose" value={last.value} unit={last.unit} />
			<StatCard label="Est. level" value={now.value} unit={now.unit} />
		</div>

		<div>
			<h2 class="section-label mb-2 px-1">Estimated levels</h2>
			<div class="flex gap-1.5 mb-3">
				{#each RANGES as r (r.value)}
					<Chip selected={range === r.value} onclick={() => (range = r.value)} class="flex-1 px-0">{r.label}</Chip>
				{/each}
			</div>
			<Card>
				<LevelChart {points} {fromMs} toMs={data.nowMs} />
			</Card>
			<p class="mt-2 px-1 text-xs leading-relaxed text-[var(--color-text-muted)]">
				Decayed from each logged dose at a {formatHalfLife(compound.halfLifeHours)} half-life{#if compound.lastDoseDate}, most recently
					{fmtDate(compound.lastDoseDate)}{/if}. A rough single-compartment estimate — not a real PK model, and
				not dosing guidance. Adjust the half-life under
				<a href="/peptides/manage" class="text-[var(--color-accent)]">manage</a>.
			</p>
		</div>

		{#if compound.nextDue || compound.flexibleSchedule}
			<div>
				<h2 class="section-label mb-2 px-1">Next dose</h2>
				<Card>
					{#if compound.flexibleSchedule}
						<p class="text-sm text-[var(--color-text-muted)]">
							This protocol sets a weekly target rather than fixed days, so there's no specific next date to
							count down to.
						</p>
					{:else if daysToNext != null}
						<div class="flex flex-col items-center py-2">
							<div class="relative h-36 w-36">
								<svg viewBox="0 0 140 140" class="h-36 w-36 -rotate-90" role="img" aria-hidden="true">
									<defs>
										<linearGradient id="ring-grad" x1="0" y1="0" x2="1" y2="1">
											<stop offset="0%" class="[stop-color:var(--color-success)]" />
											<stop offset="100%" class="[stop-color:var(--color-accent)]" />
										</linearGradient>
									</defs>
									<circle cx="70" cy="70" r={RING_R} fill="none" class="stroke-[var(--color-surface-alt)]" stroke-width="10" />
									<circle
										cx="70"
										cy="70"
										r={RING_R}
										fill="none"
										stroke="url(#ring-grad)"
										stroke-width="10"
										stroke-linecap="round"
										stroke-dasharray={RING_C}
										stroke-dashoffset={RING_C * (1 - ringFraction)}
									/>
								</svg>
								<div class="absolute inset-0 flex flex-col items-center justify-center">
									<span class="text-2xl font-semibold text-[var(--color-text)] tabular-nums">
										{daysToNext === 0 ? 'Today' : `${daysToNext} day${daysToNext === 1 ? '' : 's'}`}
									</span>
									<span class="text-xs text-[var(--color-text-muted)]">
										{daysToNext === 0 ? 'dose is due' : 'to next dose'}
									</span>
								</div>
							</div>
							<p class="mt-1 text-xs text-[var(--color-text-muted)] tabular-nums">{fmtDate(compound.nextDue!)}</p>
						</div>
					{/if}
				</Card>
			</div>
		{/if}
	{/if}
</div>
