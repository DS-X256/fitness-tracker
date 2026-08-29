<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import HealthNav from '$lib/components/HealthNav.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import HintCard from '$lib/components/HintCard.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import BodyTrendChart from '$lib/components/body/BodyTrendChart.svelte';
	import LogBodyMetricsModal from '$lib/components/body/LogBodyMetricsModal.svelte';
	import WeightGoalModal from '$lib/components/body/WeightGoalModal.svelte';
	import BodyProfileModal from '$lib/components/body/BodyProfileModal.svelte';
	import AiInsightCard from '$lib/components/ai/AiInsightCard.svelte';
	import { cmToDisplay, formatLength, formatWeight, kgToDisplay, round1 } from '$lib/utils/units';
	import { bmiCategory, bmiCategoryLabel, computeBmi } from '$lib/utils/bmi';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let logOpen = $state(false);
	let goalOpen = $state(false);
	let profileOpen = $state(false);

	const wUnit = $derived(data.settings.weightUnit);
	const bmi = $derived(data.stats ? computeBmi(data.stats.weightKg, data.settings.heightCm) : null);

	const measurements = $derived(
		data.latest
			? [
					{ label: 'Waist', cm: data.latest.waistCm },
					{ label: 'Chest', cm: data.latest.chestCm },
					{ label: 'Arm', cm: data.latest.armCm },
					{ label: 'Thigh', cm: data.latest.thighCm },
					{ label: 'Hips', cm: data.latest.hipsCm },
					{ label: 'Neck', cm: data.latest.neckCm },
					{ label: 'Calf', cm: data.latest.calfCm }
				].filter((m): m is { label: string; cm: number } => m.cm != null)
			: []
	);

	const goalForModal = $derived(
		data.goal ? { targetWeightKg: data.goal.targetWeightKg, targetDate: data.goal.targetDate } : null
	);

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}

	function fmtChange(kg: number | null | undefined) {
		if (kg == null) return null;
		const d = round1(kgToDisplay(kg, wUnit));
		return `${d > 0 ? '+' : ''}${d} ${wUnit}`;
	}
</script>

<svelte:head><title>Body · Fitness Tracker</title></svelte:head>

<PageHeader title="Body">
	{#snippet actions()}
		<button
			type="button"
			aria-label="Units & profile"
			onclick={() => (profileOpen = true)}
			class="h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
		>
			<Icon name="sliders" size={18} />
		</button>
	{/snippet}
</PageHeader>

<HealthNav />

<div class="mx-auto max-w-md px-4 pb-4 space-y-5">
	<HintCard id="body-intro" icon="scale">
		Track your weight, body measurements, and private progress photos. Your photos are encrypted and never leave your account.
	</HintCard>

	<!-- Weight summary -->
	<Card>
		<div class="flex items-center justify-between mb-3">
			<h2 class="section-label">Weight</h2>
			<button
				type="button"
				aria-label="Edit weight goal"
				onclick={() => (goalOpen = true)}
				class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
			>
				<Icon name="target" size={16} />
			</button>
		</div>

		{#if data.stats}
			<div class="flex items-end justify-between gap-3">
				<div>
					<p class="text-3xl font-semibold text-[var(--color-text)] tabular-nums">{formatWeight(data.stats.weightKg, wUnit)}</p>
					<p class="text-xs text-[var(--color-text-muted)] mt-0.5">as of {fmtDate(data.stats.date)}</p>
				</div>
				<div class="text-right text-xs text-[var(--color-text-muted)] space-y-0.5">
					{#if fmtChange(data.stats.change30)}<p class="tabular-nums">{fmtChange(data.stats.change30)} <span class="opacity-70">30d</span></p>{/if}
					{#if data.stats.weeklyRateKg}<p class="tabular-nums">{fmtChange(data.stats.weeklyRateKg)}<span class="opacity-70">/wk</span></p>{/if}
					{#if bmi}<p class="tabular-nums">BMI {bmi} · {bmiCategoryLabel(bmiCategory(bmi))}</p>{/if}
				</div>
			</div>
		{:else}
			<p class="text-sm text-[var(--color-text-muted)] py-2">No weigh-ins yet. Log your first below to start the trend.</p>
		{/if}

		{#if data.goal}
			<div class="mt-4 pt-4 border-t border-[var(--color-border)]">
				<div class="flex items-center justify-between mb-1.5">
					<span class="section-label">Goal</span>
					<span class="text-sm text-[var(--color-text)] tabular-nums">{formatWeight(data.goal.targetWeightKg, wUnit)}</span>
				</div>
				{#if data.goal.achieved}
					<p class="text-sm text-[var(--color-success)] font-medium">Reached — nice work 🎉</p>
				{:else}
					<div class="h-1.5 rounded-full bg-[var(--color-surface-alt)] overflow-hidden">
						<div class="h-full rounded-full bg-[var(--color-accent)]" style={`width:${(data.goal.progress ?? 0) * 100}%`}></div>
					</div>
					<p class="mt-1.5 text-xs text-[var(--color-text-muted)] tabular-nums">
						{#if data.goal.remainingKg != null}{Math.abs(round1(kgToDisplay(data.goal.remainingKg, wUnit)))} {wUnit} to go{/if}
						{#if data.goal.etaWeeks}· ~{data.goal.etaWeeks} weeks at current rate{/if}
						{#if data.goal.targetDate}· by {fmtDate(data.goal.targetDate)}{/if}
					</p>
				{/if}
			</div>
		{:else}
			<button type="button" onclick={() => (goalOpen = true)} class="mt-4 pt-4 border-t border-[var(--color-border)] w-full text-left text-sm text-[var(--color-accent)]">
				Set a weight goal
			</button>
		{/if}
	</Card>

	<Button variant="primary" size="lg" full class="w-full" onclick={() => (logOpen = true)}>
		<Icon name="plus" size={20} />
		Log weight & measurements
	</Button>

	{#if data.trend.length > 1}
		<Card>
			<h2 class="section-label mb-2">Trend</h2>
			<BodyTrendChart points={data.trend} unit={wUnit} />
		</Card>
	{/if}

	{#if data.stats}
		<AiInsightCard
			title="Body insights"
			disclosure="Sends your weight trend, rate, goal progress, and BMI to Claude to generate this summary."
			action="?/generateBodyInsight"
			insight={data.insight}
			aiAvailable={data.aiAvailable}
			buttonLabel="Generate insight"
		/>
	{/if}

	{#if measurements.length > 0}
		<div>
			<h2 class="section-label mb-2 px-1">Latest measurements</h2>
			<Card>
				<div class="grid grid-cols-3 gap-3">
					{#each measurements as m (m.label)}
						<StatCard label={m.label} value={round1(cmToDisplay(m.cm, data.settings.lengthUnit))} unit={data.settings.lengthUnit} />
					{/each}
					{#if data.latest?.bodyFatPct != null}
						<StatCard label="Body fat" value={data.latest.bodyFatPct} unit="%" />
					{/if}
				</div>
			</Card>
		</div>
	{/if}

	<!-- Progress photos -->
	<div>
		<div class="flex items-center justify-between mb-2 px-1">
			<h2 class="section-label">Progress photos</h2>
			<a href="/body/photos" class="text-xs text-[var(--color-accent)]">
				{data.photoCount > 0 ? `View all (${data.photoCount})` : 'Add'}
			</a>
		</div>
		{#if data.photos.length > 0}
			<div class="flex gap-2 overflow-x-auto pb-1">
				{#each data.photos as p (p.id)}
					<a href="/body/photos" class="shrink-0">
						<img src={`/body/photos/${p.id}/file`} alt={`Progress photo ${fmtDate(p.date)}`} class="h-24 w-24 rounded-[var(--radius-md)] object-cover bg-[var(--color-surface-alt)]" loading="lazy" />
					</a>
				{/each}
			</div>
		{:else}
			<Card href="/body/photos">
				<div class="flex items-center gap-3 text-[var(--color-text-muted)]">
					<Icon name="camera" size={22} />
					<span class="text-sm">Add your first progress photo — private and encrypted.</span>
				</div>
			</Card>
		{/if}
	</div>

	{#if data.recent.length > 0}
		<div>
			<h2 class="section-label mb-2 px-1">History</h2>
			<Card padded={false} class="divide-y divide-[var(--color-border)]">
				{#each data.recent as entry (entry.id)}
					<div class="flex items-center gap-2 px-4 py-2.5">
						<div class="flex-1 min-w-0">
							<p class="text-sm text-[var(--color-text)]">
								{fmtDate(entry.date)}
								{#if entry.weightKg != null}<span class="text-[var(--color-text-muted)]"> · {formatWeight(entry.weightKg, wUnit)}</span>{/if}
							</p>
							{#if entry.bodyFatPct != null || entry.waistCm != null}
								<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
									{#if entry.bodyFatPct != null}{entry.bodyFatPct}% bf{/if}
									{#if entry.waistCm != null}{#if entry.bodyFatPct != null} · {/if}waist {formatLength(entry.waistCm, data.settings.lengthUnit)}{/if}
								</p>
							{/if}
						</div>
						<form method="POST" action="?/deleteMetric" use:enhance>
							<input type="hidden" name="id" value={entry.id} />
							<button type="submit" aria-label={`Delete ${fmtDate(entry.date)}`} class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]">
								<Icon name="x" size={16} />
							</button>
						</form>
					</div>
				{/each}
			</Card>
		</div>
	{/if}
</div>

<LogBodyMetricsModal bind:open={logOpen} settings={data.settings} initial={data.today} />
<WeightGoalModal bind:open={goalOpen} settings={data.settings} goal={goalForModal} />
<BodyProfileModal bind:open={profileOpen} settings={data.settings} />
