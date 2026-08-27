<script lang="ts">
	import { enhance } from '$app/forms';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ProgressRing from '$lib/components/nutrition/ProgressRing.svelte';
	import MacroBar from '$lib/components/nutrition/MacroBar.svelte';
	import TargetsModal from '$lib/components/nutrition/TargetsModal.svelte';
	import LogFoodModal from '$lib/components/nutrition/LogFoodModal.svelte';
	import SettingsModal from '$lib/components/SettingsModal.svelte';
	import HintCard from '$lib/components/HintCard.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import AiInsightCard from '$lib/components/ai/AiInsightCard.svelte';
	import { formatPortions } from '$lib/utils/formatPortions';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let targetsOpen = $state(false);
	let logOpen = $state(false);
	let settingsOpen = $state(false);

	const kcalRemaining = $derived(data.targets ? Math.round(data.targets.calories - data.summary.calories) : 0);

	const dateLabel = new Date().toLocaleDateString(undefined, {
		weekday: 'long',
		month: 'long',
		day: 'numeric'
	});

	function fmtWeight(n: number) {
		return n;
	}

	function trend(history: { topWeight: number }[]) {
		const window = history.slice(-4);
		return {
			first: window[0]?.topWeight ?? 0,
			last: window[window.length - 1]?.topWeight ?? 0,
			sessionsCount: window.length
		};
	}
</script>

<svelte:head><title>Fitness Tracker</title></svelte:head>

<div class="mx-auto max-w-md px-4 pt-[calc(1.25rem+env(safe-area-inset-top))] pb-4 space-y-5">
	<div class="flex items-center justify-between">
		<div>
			<p class="text-sm text-[var(--color-text-muted)]">{dateLabel}</p>
			<h1 class="text-2xl text-[var(--color-text)]">Today</h1>
		</div>
		<button
			type="button"
			aria-label="Settings"
			onclick={() => (settingsOpen = true)}
			class="h-10 w-10 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
		>
			<Icon name="sliders" size={20} />
		</button>
	</div>

	<HintCard id="home-intro" icon="home">
		Your day at a glance — log food, start a workout, and watch your targets fill in
		as you go.
	</HintCard>

	<!-- Nutrition dashboard — the primary content -->
	<Card>
		<div class="flex items-center justify-between mb-3">
			<h2 class="section-label">Nutrition</h2>
			<div class="flex items-center gap-0.5">
				<a
					href="/diary"
					class="h-8 px-2.5 flex items-center gap-1 rounded-full text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
				>
					<Icon name="chart" size={15} />
					Diary
				</a>
				<button
					type="button"
					aria-label="Edit daily targets"
					onclick={() => (targetsOpen = true)}
					class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
				>
					<Icon name="sliders" size={16} />
				</button>
			</div>
		</div>

		{#if data.targets}
			<div class="flex items-center gap-4">
				<div class="flex flex-col items-center gap-1">
					<ProgressRing value={data.summary.calories} target={data.targets.calories} />
					<p
						class={`text-xs ${kcalRemaining < 0 ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}`}
					>
						{#if kcalRemaining >= 0}{kcalRemaining} kcal left{:else}{-kcalRemaining} kcal over{/if}
					</p>
				</div>
				<div class="flex-1 space-y-3 min-w-0">
					<MacroBar label="Protein" value={data.summary.protein} target={data.targets.protein} />
					<MacroBar label="Carbs" value={data.summary.carbs} target={data.targets.carbs} />
					<MacroBar label="Fat" value={data.summary.fat} target={data.targets.fat} />
				</div>
			</div>
		{:else}
			<div class="text-center py-4">
				{#if data.summary.calories > 0}
					<p class="text-sm text-[var(--color-text)] mb-1">
						Logged today: <span class="font-medium">{Math.round(data.summary.calories)} kcal</span>
					</p>
					<p class="text-xs text-[var(--color-text-muted)] mb-3">
						{Math.round(data.summary.protein)}g protein · {Math.round(data.summary.carbs)}g carbs · {Math.round(
							data.summary.fat
						)}g fat
					</p>
				{:else}
					<p class="text-sm text-[var(--color-text-muted)] mb-3">
						Set daily targets for calories and macros to start tracking your day.
					</p>
				{/if}
				<Button variant="primary" onclick={() => (targetsOpen = true)}>Set your daily targets</Button>
			</div>
		{/if}
	</Card>

	<Button variant="primary" size="lg" full class="w-full" onclick={() => (logOpen = true)}>
		<Icon name="plus" size={20} />
		Log food
	</Button>

	{#if data.entries.length > 0}
		<div>
			<h2 class="section-label mb-2 px-1">Logged today</h2>
			<Card padded={false} class="divide-y divide-[var(--color-border)]">
				{#each data.entries as entry (entry.id)}
					<div class="flex items-center gap-2 px-4 py-2.5">
						{#snippet entryBody()}
							<p class="truncate text-sm text-[var(--color-text)]">
								{entry.name}{#if entry.brand}<span class="text-[var(--color-text-muted)]"> · {entry.brand}</span>{/if}
							</p>
							<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
								×{formatPortions(entry.portions)} · {Math.round(entry.calories)} kcal · {Math.round(entry.protein)}p
								{Math.round(entry.carbs)}c {Math.round(entry.fat)}f
							</p>
						{/snippet}
						{#if entry.mealId}
							<a href={`/meals/${entry.mealId}`} class="flex-1 min-w-0 flex items-center gap-1 group">
								<span class="flex-1 min-w-0">{@render entryBody()}</span>
								<Icon name="chevron-right" size={15} class="shrink-0 text-[var(--color-text-muted)] opacity-0 group-hover:opacity-100 transition-opacity" />
							</a>
						{:else}
							<div class="flex-1 min-w-0">{@render entryBody()}</div>
						{/if}
						<form method="POST" action="?/deleteLog" use:enhance>
							<input type="hidden" name="id" value={entry.id} />
							<button
								type="submit"
								aria-label={`Remove ${entry.name}`}
								class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
							>
								<Icon name="x" size={16} />
							</button>
						</form>
					</div>
				{/each}
			</Card>
		</div>
	{/if}

	<div>
		<h2 class="section-label mb-2 px-1">Workout</h2>
		{#if data.todayWorkout}
			<Card href={`/workouts/${data.todayWorkout.id}`}>
				<div class="flex items-center justify-between">
					<div class="min-w-0">
						<p class="font-medium text-[var(--color-text)] truncate">
							{data.todayWorkout.planName ?? 'Workout in progress'}
						</p>
						<p class="text-sm text-[var(--color-text-muted)] mt-0.5">
							{#if data.todayWorkout.exercisesTotal}
								{data.todayWorkout.exercisesDone}/{data.todayWorkout.exercisesTotal} exercises
							{:else}
								{data.todayWorkout.exercisesDone}
								{data.todayWorkout.exercisesDone === 1 ? 'exercise' : 'exercises'}
							{/if}
							·
							{#if data.todayWorkout.setsTarget}
								{data.todayWorkout.setsDone}/{data.todayWorkout.setsTarget} sets
							{:else}
								{data.todayWorkout.setsDone} {data.todayWorkout.setsDone === 1 ? 'set' : 'sets'}
							{/if}
						</p>
					</div>
					<span class="flex items-center gap-1 text-sm text-[var(--color-accent)] shrink-0">
						Continue <Icon name="chevron-right" size={16} />
					</span>
				</div>
			</Card>
		{:else}
			<div class="flex gap-2">
				<form method="POST" action="/workouts?/start" use:enhance class="flex-1">
					<Button type="submit" variant="secondary" full class="w-full">
						<Icon name="dumbbell" size={18} />
						Start workout
					</Button>
				</form>
				<Button href="/workouts/plans" variant="ghost">From a plan</Button>
			</div>
		{/if}
	</div>

	{#if data.goals.length > 0}
		<div>
			<h2 class="section-label mb-2 px-1">Goals</h2>
			<div class="space-y-2">
				{#each data.goals as goal (goal.exerciseId)}
					<Card href={`/exercises/${goal.exerciseId}`}>
						<div class="flex items-center justify-between gap-2 mb-1.5">
							<span class="font-medium text-[var(--color-text)] truncate">
								{goal.exerciseName}{#if goal.exerciseBrand}<span class="text-[var(--color-text-muted)]"> — {goal.exerciseBrand}</span>{/if}
							</span>
							<span
								class={`text-sm shrink-0 tabular-nums ${goal.achieved ? 'text-[var(--color-success)] font-medium' : 'text-[var(--color-text-muted)]'}`}
							>
								{#if goal.achieved}✓ done{:else}{Math.round(goal.progress * 100)}%{/if}
							</span>
						</div>
						<p class="text-xs text-[var(--color-text-muted)] mb-1.5">
							{#if goal.bestQualifying}
								Best {fmtWeight(goal.bestQualifying.weight)} kg × {goal.bestQualifying.reps}
							{:else if goal.bestOverall}
								Best {fmtWeight(goal.bestOverall.weight)} kg × {goal.bestOverall.reps} (below rep target)
							{:else}
								No sets logged yet
							{/if}
							· Goal {fmtWeight(goal.targetWeight)} kg × {goal.targetReps}
						</p>
						<div class="h-1.5 rounded-full bg-[var(--color-surface-alt)] overflow-hidden">
							<div
								class={`h-full rounded-full ${goal.achieved ? 'bg-[var(--color-success)]' : 'bg-[var(--color-accent)]'}`}
								style={`width:${goal.progress * 100}%`}
							></div>
						</div>
					</Card>
				{/each}
			</div>
		</div>
	{/if}

	{#if data.exerciseProgress.length > 0}
		<div>
			<h2 class="section-label mb-2 px-1">Progress</h2>
			<div class="space-y-2">
				{#each data.exerciseProgress as progress (progress.exercise.id)}
					{@const t = trend(progress.history)}
					<Card href={`/exercises/${progress.exercise.id}`} class="flex items-center justify-between gap-2">
						<span class="font-medium text-[var(--color-text)] truncate">
							{progress.exercise.name}{#if progress.exercise.brand}<span class="text-[var(--color-text-muted)]"> — {progress.exercise.brand}</span>{/if}
						</span>
						<span class="text-sm text-[var(--color-text-muted)] shrink-0">
							{#if t.sessionsCount > 1}
								{fmtWeight(t.first)}kg &rarr; {fmtWeight(t.last)}kg &middot; {t.sessionsCount} sessions
							{:else}
								{fmtWeight(t.last)}kg
							{/if}
						</span>
					</Card>
				{/each}
			</div>
		</div>
	{/if}

	{#if data.week.daysLogged > 0 || data.week.workouts > 0}
		<div>
			<h2 class="section-label mb-2 px-1">This week</h2>
			<Card>
				<div class="grid grid-cols-3 gap-3">
					<StatCard label="Avg kcal/day" value={data.week.avg?.calories ?? '—'} />
					<StatCard label="Avg protein" value={data.week.avg?.protein ?? '—'} unit={data.week.avg ? 'g' : ''} />
					<StatCard label="Workouts" value={data.week.workouts} />
				</div>
				<p class="mt-3 text-xs text-[var(--color-text-muted)] tabular-nums">
					{data.week.daysLogged} of 7 days logged{#if data.week.sets > 0}&nbsp;· {data.week.sets} sets{/if}
				</p>
				{#if data.week.muscleGroups.length > 0}
					{@const maxSets = Math.max(...data.week.muscleGroups.map((m) => m.sets))}
					<div class="mt-3 pt-3 border-t border-[var(--color-border)] space-y-1.5">
						<p class="section-label">Sets by muscle</p>
						{#each data.week.muscleGroups as m (m.label)}
							<div class="flex items-center gap-2">
								<span class="w-24 shrink-0 text-xs text-[var(--color-text-muted)] truncate">{m.label}</span>
								<div class="flex-1 h-1.5 rounded-full bg-[var(--color-surface-alt)] overflow-hidden">
									<div
										class="h-full rounded-full bg-[var(--color-accent)]"
										style={`width:${maxSets ? (m.sets / maxSets) * 100 : 0}%`}
									></div>
								</div>
								<span class="w-6 shrink-0 text-right text-xs tabular-nums text-[var(--color-text)]">{m.sets}</span>
							</div>
						{/each}
					</div>
				{/if}
			</Card>
		</div>
	{/if}

	{#if data.week.daysLogged > 0 || data.week.workouts > 0}
		<AiInsightCard
			title="Weekly insights"
			disclosure="Sends this week's numbers to Claude to generate this summary."
			action="?/generateDigest"
			regenerateAction="?/regenerateDigest"
			insight={data.digest}
			aiAvailable={data.aiAvailable}
			buttonLabel="Generate this week's insights"
		/>
	{/if}
</div>

<TargetsModal bind:open={targetsOpen} targets={data.targets} />
<LogFoodModal bind:open={logOpen} meals={data.logMeals} products={data.logProducts} />
<SettingsModal bind:open={settingsOpen} />
