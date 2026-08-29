<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import AiInsightCard from '$lib/components/ai/AiInsightCard.svelte';
	import { shiftIsoDate } from '$lib/utils/isoDate';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	function dayLabel(date: string) {
		if (date === data.today) return 'Today';
		if (date === shiftIsoDate(data.today, -1)) return 'Yesterday';
		const [y, m, d] = date.split('-').map(Number);
		const dt = new Date(y, m - 1, d);
		return dt.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:head><title>Food diary · Fitness Tracker</title></svelte:head>

<PageHeader title="Food diary" back="/" />

<div class="mx-auto max-w-md px-4 pb-4 space-y-2">
	{#if data.days.length === 0}
		<EmptyState
			icon="meals"
			title="No days logged yet"
			description="Each day you log food shows up here, ready to look back on — or fix if you forgot something."
		/>
	{:else}
		<AiInsightCard
			title="Nutrition insights"
			disclosure="Sends your recent calorie/macro averages and targets to Claude to generate this summary."
			action="?/generateNutritionInsight"
			insight={data.insight}
			aiAvailable={data.aiAvailable}
			buttonLabel="Generate insight"
		/>

		{#each data.days as day (day.date)}
			<Card href={`/diary/${day.date}`}>
				<div class="flex items-center justify-between gap-2">
					<div class="min-w-0">
						<p class="font-medium text-[var(--color-text)] truncate">{dayLabel(day.date)}</p>
						<p class="text-xs text-[var(--color-text-muted)] tabular-nums mt-0.5">
							{Math.round(day.protein)}p · {Math.round(day.carbs)}c · {Math.round(day.fat)}f
							· {day.entryCount} {day.entryCount === 1 ? 'item' : 'items'}
						</p>
					</div>
					<div class="flex items-center gap-1 shrink-0">
						<div class="text-right">
							<p class="font-medium tabular-nums text-[var(--color-text)]">{Math.round(day.calories)}</p>
							<p class="text-[10px] uppercase tracking-wide text-[var(--color-text-muted)]">
								kcal{#if data.targets} / {Math.round(data.targets.calories)}{/if}
							</p>
						</div>
						<Icon name="chevron-right" size={18} class="text-[var(--color-text-muted)]" />
					</div>
				</div>
			</Card>
		{/each}
	{/if}
</div>
