<script lang="ts">
	import { onMount } from 'svelte';
	import { enhance } from '$app/forms';
	import { invalidate } from '$app/navigation';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import TextareaField from '$lib/components/TextareaField.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import SetRow from '$lib/components/workouts/SetRow.svelte';
	import QuickEntryRow from '$lib/components/workouts/QuickEntryRow.svelte';
	import ExercisePicker from '$lib/components/workouts/ExercisePicker.svelte';
	import RestTimer from '$lib/components/workouts/RestTimer.svelte';
	import TrainTogetherModal from '$lib/components/workouts/TrainTogetherModal.svelte';
	import AiInsightCard from '$lib/components/ai/AiInsightCard.svelte';
	import { groupIntoBlocks, isSuperset, supersetLabel, type Block } from '$lib/utils/supersets';
	import { todayIso } from '$lib/utils/todayIso';
	import { shiftIsoDate } from '$lib/utils/isoDate';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	let trainOpen = $state(false);

	// Poll partner progress while this screen is open — cheap (one grouped query) and gives a
	// "someone else just logged a set" feel without adding a websocket layer for one panel.
	onMount(() => {
		const interval = setInterval(() => invalidate('workout:training-partners'), 15000);
		return () => clearInterval(interval);
	});

	function relativeTime(date: Date): string {
		const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
		if (seconds < 60) return 'just now';
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.round(minutes / 60);
		return `${hours}h ago`;
	}

	type ExerciseOption = { id: number; name: string; brand: string | null; muscleGroup: string | null };
	type SetEntry = { id: number; exerciseId: number; reps: number; weight: number; rpe: number | null; notes: string | null };
	type Group = {
		exerciseId: number;
		exerciseName: string;
		exerciseBrand?: string | null;
		sets: SetEntry[];
		targetSets?: number | null;
		restSeconds?: number | null;
		notes?: string | null;
		supersetGroup?: number | null;
	};

	let dateValue = $state(data.session.date);
	let notesValue = $state(data.session.notes ?? '');
	let sessionError = $state('');

	let pickerOpen = $state(false);
	// Exercises picked/created in this session before any set has been logged for them yet —
	// once a set is added, the exercise arrives via `data.exerciseGroups` and is de-duped out of here.
	let manuallyAdded = $state<ExerciseOption[]>([]);

	// Extra blank set rows requested beyond an exercise's target (or beyond the default single row),
	// client-only — once submitted they become real logged sets like anything else.
	let extraSlots = $state<Record<number, number>>({});

	// A session started from a plan never carries over last time's numbers — starts genuinely blank.
	const noPrefill = $derived(!!data.session.planId);

	// Plan-based sessions render in the plan's own order (a stable "where am I" sequence) rather than
	// reshuffling completed exercises to the front; non-plan sessions keep the original ordering.
	const sessionExerciseList = $derived<Group[]>(
		data.session.planId
			? [
					...data.planExercises.map((p) => {
						const logged = data.exerciseGroups.find((g) => g.exerciseId === p.exerciseId);
						return {
							exerciseId: p.exerciseId,
							exerciseName: p.exerciseName,
							exerciseBrand: p.exerciseBrand,
							sets: logged?.sets ?? [],
							targetSets: p.targetSets,
							restSeconds: p.restSeconds,
							notes: p.notes,
							supersetGroup: p.supersetGroup
						};
					}),
					...data.exerciseGroups.filter((g) => !data.planExercises.some((p) => p.exerciseId === g.exerciseId)),
					...manuallyAdded
						.filter((m) => !data.planExercises.some((p) => p.exerciseId === m.id))
						.filter((m) => !data.exerciseGroups.some((g) => g.exerciseId === m.id))
						.map((m) => ({ exerciseId: m.id, exerciseName: m.name, exerciseBrand: m.brand, sets: [] as SetEntry[] }))
				]
			: [
					...data.exerciseGroups,
					...manuallyAdded
						.filter((m) => !data.exerciseGroups.some((g) => g.exerciseId === m.id))
						.map((m) => ({ exerciseId: m.id, exerciseName: m.name, exerciseBrand: m.brand, sets: [] as SetEntry[] }))
				]
	);

	const totalTarget = $derived(sessionExerciseList.reduce((sum, g) => sum + (g.targetSets ?? 0), 0));
	const totalDone = $derived(
		sessionExerciseList.reduce((sum, g) => sum + Math.min(g.sets.length, g.targetSets ?? g.sets.length), 0)
	);
	const totalLogged = $derived(sessionExerciseList.reduce((sum, g) => sum + g.sets.length, 0));

	// Render blocks: consecutive plan exercises sharing a superset group collapse into one block.
	const blocks = $derived(groupIntoBlocks(sessionExerciseList, (g) => g.supersetGroup ?? null));

	// ── Session state model ─────────────────────────────────────────────────────
	// A workout is an ordered sequence; the screen answers "what's done / now / next".
	// Only plan sessions carry targets, so the done/active/upcoming language is plan-only —
	// a freestyle session stays neutral (every card equal), just logging as it goes.
	const isPlan = $derived(!!data.session.planId);

	function hasTarget(g: Group) {
		return g.targetSets != null && g.targetSets > 0;
	}
	function isDone(g: Group) {
		return hasTarget(g) && g.sets.length >= (g.targetSets as number);
	}

	// The first block still carrying an unfinished set — where the lifter is "now". -1 once all done.
	const activeBlockIndex = $derived(isPlan ? blocks.findIndex((b) => !b.items.every(isDone)) : -1);

	function blockState(bi: number): 'done' | 'active' | 'upcoming' | 'neutral' {
		if (!isPlan) return 'neutral';
		if (activeBlockIndex === -1 || bi < activeBlockIndex) return 'done';
		return bi === activeBlockIndex ? 'active' : 'upcoming';
	}

	// The single exercise to be on now: first not-yet-complete exercise inside the active block.
	const activeName = $derived.by(() => {
		if (!isPlan || activeBlockIndex === -1) return null;
		const b = blocks[activeBlockIndex];
		return (b.items.find((g) => !isDone(g)) ?? b.items[0])?.exerciseName ?? null;
	});
	const sessionComplete = $derived(isPlan && totalTarget > 0 && activeBlockIndex === -1);

	// The Set Ledger: one segment per exercise, one tick per target set. Filled ticks turn green
	// once that exercise hits its target, terracotta while it's still being worked.
	type LedgerSeg = { exerciseId: number; name: string; filled: number; total: number; extra: number; done: boolean; active: boolean };
	const ledger = $derived.by<LedgerSeg[]>(() => {
		const out: LedgerSeg[] = [];
		blocks.forEach((block, bi) => {
			const active = blockState(bi) === 'active';
			for (const g of block.items) {
				const target = g.targetSets ?? 0;
				const logged = g.sets.length;
				const total = target > 0 ? target : Math.max(logged, 1);
				out.push({
					exerciseId: g.exerciseId,
					name: g.exerciseName,
					filled: Math.min(logged, total),
					total,
					extra: Math.max(0, logged - total),
					done: isDone(g),
					active
				});
			}
		});
		return out;
	});

	// Total tonnage moved this session — a quiet, ambient "work done" readout, never the hero number.
	const volume = $derived(
		sessionExerciseList.reduce((sum, g) => sum + g.sets.reduce((a, s) => a + s.reps * s.weight, 0), 0)
	);
	function fmtVolume(v: number) {
		return v >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v));
	}

	const planLabel = $derived(data.planName ?? (isPlan ? 'Plan' : 'Freestyle'));
	const heroDate = $derived(
		new Date(`${data.session.date}T00:00:00`).toLocaleDateString(undefined, {
			weekday: 'short',
			month: 'short',
			day: 'numeric'
		})
	);

	// Completed exercises/blocks collapse to a one-line recap; tapping expands them to edit.
	let expandedBlocks = $state<Record<string, boolean>>({});
	function blockKey(block: Block<Group>) {
		return block.superset ? `g${block.group}` : `e${block.items[0].exerciseId}`;
	}
	function toggleBlock(key: string) {
		expandedBlocks = { ...expandedBlocks, [key]: !expandedBlocks[key] };
	}
	function setsRecap(g: Group) {
		return g.sets.map((s) => `${s.reps}×${s.weight}`).join(' · ');
	}

	let restTarget = $state(90);
	let restKey = $state(0);
	let restStarted = $state(false);

	function startRest(seconds: number) {
		restTarget = seconds;
		restKey += 1;
		restStarted = true;
	}

	function handleExercisePicked(ex: ExerciseOption) {
		if (!manuallyAdded.some((m) => m.id === ex.id)) {
			manuallyAdded = [...manuallyAdded, ex];
		}
		pickerOpen = false;
	}

	function remainingSlotCount(group: Group) {
		const base = Math.max(0, (group.targetSets ?? 1) - group.sets.length);
		return base + (extraSlots[group.exerciseId] ?? 0);
	}

	function addExtraSlot(exerciseId: number) {
		extraSlots = { ...extraSlots, [exerciseId]: (extraSlots[exerciseId] ?? 0) + 1 };
	}

	function slotDefaults(group: Group, slotIndex: number) {
		if (noPrefill || slotIndex > 0) return { reps: 0, weight: 0 };
		const lastInSession = group.sets[group.sets.length - 1];
		if (lastInSession) return { reps: lastInSession.reps, weight: lastInSession.weight };
		const lastHistoric = data.lastSetsByExercise[group.exerciseId]?.[0];
		if (lastHistoric) return { reps: lastHistoric.reps, weight: lastHistoric.weight };
		return { reps: 0, weight: 0 };
	}

	function formatDate(d: string) {
		const date = new Date(`${d}T00:00:00`);
		return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
	}

	const today = todayIso();
	const headerTitle = $derived(
		data.session.date === today
			? "Today's workout"
			: data.session.date === shiftIsoDate(today, -1)
				? "Yesterday's workout"
				: formatDate(data.session.date)
	);
</script>

<svelte:head><title>{formatDate(data.session.date)} · Workout</title></svelte:head>

<PageHeader title={headerTitle} back="/workouts">
	{#snippet actions()}
		<button
			type="button"
			aria-label="Train together"
			onclick={() => (trainOpen = true)}
			class="relative h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
		>
			<Icon name="users" size={18} />
			{#if data.trainingPartners.length > 0}
				<span class="absolute top-1.5 right-1.5 h-2 w-2 rounded-full bg-[var(--color-accent)]"></span>
			{/if}
		</button>
		<form
			method="POST"
			action="?/deleteSession"
			use:enhance={({ cancel }) => {
				if (!confirm('Delete this workout session? This also deletes all logged sets in it.')) {
					cancel();
					return;
				}
			}}
		>
			<button
				type="submit"
				aria-label="Delete session"
				class="h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
			>
				<Icon name="trash" size={18} />
			</button>
		</form>
	{/snippet}
</PageHeader>

<div class="mx-auto max-w-md px-4 space-y-4">
	{#if restStarted}
		{#key restKey}
			<RestTimer targetSeconds={restTarget} />
		{/key}
	{/if}

	{#if data.trainingPartners.length > 0}
		<section class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5">
			<button type="button" onclick={() => (trainOpen = true)} class="flex w-full items-center justify-between gap-2">
				<span class="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-accent)]">
					<Icon name="users" size={14} /> Training together
				</span>
				<Icon name="chevron-right" size={16} class="text-[var(--color-text-muted)]" />
			</button>
			<div class="mt-2.5 space-y-1.5">
				{#each data.trainingPartners as partner (partner.memberId)}
					<div class="flex items-center justify-between gap-2 text-sm">
						<span class="min-w-0 truncate text-[var(--color-text)]">{partner.username}</span>
						{#if partner.status === 'invited'}
							<span class="shrink-0 text-xs text-[var(--color-text-muted)]">Invited</span>
						{:else}
							<span class="shrink-0 text-xs tabular-nums text-[var(--color-text-muted)]">
								{partner.setCount} {partner.setCount === 1 ? 'set' : 'sets'}
								{#if partner.lastSetAt} &middot; {relativeTime(partner.lastSetAt)}{/if}
							</span>
						{/if}
					</div>
				{/each}
			</div>
		</section>
	{/if}

	{#if data.exerciseGroups.length > 0}
		<AiInsightCard
			title="AI coaching"
			disclosure="Sends this session's numbers to Claude to generate this advice."
			action="?/generateCoachInsight"
			insight={data.coachInsight}
			aiAvailable={data.aiAvailable}
			buttonLabel="Get AI coaching for this session"
		/>
	{/if}

	<!-- ── Session hero + Set Ledger — the session's shape at a glance ── -->
	{#if sessionExerciseList.length > 0}
		<section class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] shadow-[var(--shadow-soft)] p-4">
			<div class="flex items-center justify-between gap-3 mb-3">
				<p class="text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-accent)] truncate">{planLabel}</p>
				<p class="text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-text-muted)] shrink-0">{heroDate}</p>
			</div>

			<div class="flex items-end gap-2.5 mb-3">
				{#each ledger as seg (seg.exerciseId)}
					<a
						href={`#ex-${seg.exerciseId}`}
						class="flex items-end gap-[3px] flex-1 min-w-0"
						title={seg.name}
						aria-label={`${seg.name}, ${seg.filled} of ${seg.total} sets`}
					>
						{#each Array.from({ length: seg.total }) as _, i (i)}
							<span
								class={`flex-1 min-w-[4px] max-w-[26px] rounded-[3px] border transition-colors ${seg.active ? 'h-[30px]' : 'h-[22px]'} ${
									i < seg.filled
										? seg.done
											? 'bg-[var(--color-success)] border-[var(--color-success)]'
											: 'bg-[var(--color-accent)] border-[var(--color-accent)]'
										: seg.active
											? 'bg-[var(--color-accent-soft)] border-[var(--color-accent)]'
											: 'bg-[var(--color-surface-alt)] border-[var(--color-border)]'
								}`}
							></span>
						{/each}
						{#each Array.from({ length: seg.extra }) as _, i (`x${i}`)}
							<span class={`flex-1 min-w-[4px] max-w-[26px] rounded-[3px] border bg-[var(--color-accent-soft)] border-[var(--color-accent)] ${seg.active ? 'h-[30px]' : 'h-[22px]'}`}></span>
						{/each}
					</a>
				{/each}
			</div>

			<div class="flex items-baseline justify-between gap-3">
				<p class="text-sm min-w-0 truncate">
					{#if sessionComplete}
						<span class="inline-flex items-center gap-1 text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-success)]">
							<Icon name="check" size={13} /> All sets done
						</span>
					{:else if activeName}
						<span class="text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-text-muted)]">Now</span>
						<span class="font-serif text-base font-medium text-[var(--color-text)]"> · {activeName}</span>
					{:else}
						<span class="text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-text-muted)]">In progress</span>
					{/if}
				</p>
				<p class="shrink-0 text-sm tabular-nums text-[var(--color-text-muted)]">
					{#if totalTarget > 0}
						<span class="font-semibold text-[var(--color-text)]">{totalDone}</span> / {totalTarget} sets
					{:else}
						<span class="font-semibold text-[var(--color-text)]">{totalLogged}</span>
						{totalLogged === 1 ? 'set' : 'sets'}
					{/if}
					{#if volume > 0}<span class="text-[var(--color-text-muted)]"> · {fmtVolume(volume)} kg</span>{/if}
				</p>
			</div>
		</section>
	{/if}

	{#snippet exerciseCard(group: Group, restAfter: boolean, restSeconds: number, positionLabel: string | undefined, active: boolean)}
		{@const complete = !!group.targetSets && group.sets.length >= group.targetSets}
		{@const goal = data.goalsByExercise[group.exerciseId]}
		<div id={`ex-${group.exerciseId}`} class="scroll-mt-24 relative">
			{#if active}
				<div class="pointer-events-none absolute inset-y-4 left-0 z-10 w-1.5 rounded-full bg-[var(--color-accent)]"></div>
			{/if}
			<Card>
				<div class="flex items-center justify-between mb-1">
					<div class="flex items-baseline gap-2 min-w-0">
						{#if positionLabel}<span class="shrink-0 text-xs font-semibold text-[var(--color-accent)]">{positionLabel}</span>{/if}
						<h2 class="text-base font-medium text-[var(--color-text)] truncate">
							{group.exerciseName}{#if group.exerciseBrand}<span class="text-[var(--color-text-muted)]"> — {group.exerciseBrand}</span>{/if}
						</h2>
					</div>
					<a href={`/exercises/${group.exerciseId}`} class="text-xs font-medium text-[var(--color-accent)] shrink-0">Progress</a>
				</div>

				{#if group.targetSets || goal}
					<p class="text-xs mb-1.5 flex flex-wrap gap-x-3 gap-y-0.5">
						{#if group.targetSets}
							<span class={complete ? 'text-[var(--color-success)] font-medium' : 'text-[var(--color-text-muted)]'}>
								{#if complete}&check;&nbsp;{/if}{group.sets.length}/{group.targetSets} sets
							</span>
						{/if}
						{#if goal}
							<span class="inline-flex items-center gap-1 text-[var(--color-accent)]">
								<Icon name="target" size={12} />
								Goal: {goal.targetWeight} kg &times; {goal.targetReps}
							</span>
						{/if}
					</p>
				{/if}
				{#if group.notes}
					<p class="text-xs text-[var(--color-text-muted)] mb-2">{group.notes}</p>
				{/if}

				{#if group.sets.length > 0}
					<div class="divide-y divide-[var(--color-border)] mb-2">
						{#each group.sets as set, i (set.id)}
							<SetRow
								{set}
								index={i}
								meetsGoal={!!goal && set.weight >= goal.targetWeight && set.reps >= goal.targetReps}
							/>
						{/each}
					</div>
				{/if}

				<div class="space-y-2">
					{#each Array.from({ length: remainingSlotCount(group) }) as _, i (i)}
						{@const defaults = slotDefaults(group, i)}
						<QuickEntryRow
							exerciseId={group.exerciseId}
							label={`Set ${group.sets.length + i + 1}`}
							initialReps={defaults.reps}
							initialWeight={defaults.weight}
							onLogged={() => { if (restAfter) startRest(restSeconds); }}
						/>
					{/each}
				</div>

				<button
					type="button"
					onclick={() => addExtraSlot(group.exerciseId)}
					class="mt-2 py-1 text-sm font-medium text-[var(--color-accent)]"
				>
					+ Add another set
				</button>
			</Card>
		</div>
	{/snippet}

	{#snippet doneCard(block: Block<Group>, key: string)}
		{@const first = block.items[0]}
		<button
			type="button"
			id={`ex-${first.exerciseId}`}
			onclick={() => toggleBlock(key)}
			class="scroll-mt-24 w-full text-left rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface-alt)]/60 p-4 flex items-center gap-3"
		>
			<span class="h-7 w-7 shrink-0 flex items-center justify-center rounded-full bg-[var(--color-success-soft)] text-[var(--color-success)]">
				<Icon name="check" size={16} />
			</span>
			<span class="min-w-0 flex-1">
				{#if isSuperset(block)}
					<span class="block text-base font-medium truncate text-[var(--color-text)]">Superset {supersetLabel(block.group!)}</span>
					<span class="block text-xs text-[var(--color-text-muted)] truncate">
						{block.items.map((g) => g.exerciseName).join(' + ')} · {block.items.reduce((n, g) => n + g.sets.length, 0)} sets
					</span>
				{:else}
					<span class="block text-base font-medium truncate text-[var(--color-text)]">
						{first.exerciseName}{#if first.exerciseBrand}<span class="text-[var(--color-text-muted)]"> — {first.exerciseBrand}</span>{/if}
					</span>
					<span class="block text-xs text-[var(--color-text-muted)] truncate tabular-nums">{first.sets.length} sets · {setsRecap(first)} kg</span>
				{/if}
			</span>
			<Icon name="chevron-right" size={16} class="shrink-0 text-[var(--color-text-muted)]" />
		</button>
	{/snippet}

	{#if sessionExerciseList.length === 0}
		<EmptyState icon="dumbbell" title="No exercises yet" description="Add an exercise below to start logging sets." />
	{:else}
		<div class="space-y-4">
			{#each blocks as block, bi (blockKey(block))}
				{@const state = blockState(bi)}
				{@const key = blockKey(block)}
				<div>
					{#if state === 'done' && !expandedBlocks[key]}
						{@render doneCard(block, key)}
					{:else}
						{#if state === 'done'}
							<button
								type="button"
								onclick={() => toggleBlock(key)}
								class="mb-1.5 ml-1 flex items-center gap-1 text-xs font-medium text-[var(--color-success)]"
							>
								<Icon name="check" size={13} /> Completed · tap to collapse
							</button>
						{/if}
						{#if isSuperset(block)}
							{@const label = supersetLabel(block.group!)}
							{@const groupRest = block.items[block.items.length - 1].restSeconds ?? 90}
							{@const active = state === 'active'}
							<div class="relative rounded-[var(--radius-lg)] overflow-hidden">
								{#if active}<div class="pointer-events-none absolute inset-y-0 left-0 z-10 w-1.5 bg-[var(--color-accent)]"></div>{/if}
								<div class={`rounded-[var(--radius-lg)] border p-2 space-y-2 ${active ? 'pl-3 border-[var(--color-accent)]/45 bg-[var(--color-accent-soft)]/25' : 'border-[var(--color-border)] bg-[var(--color-surface-alt)]/30'}`}>
									<p class="section-label px-1 text-[var(--color-accent)]">
										Superset {label} · rest after {label}{block.items.length}
									</p>
									{#each block.items as group, i (group.exerciseId)}
										{@render exerciseCard(group, i === block.items.length - 1, groupRest, `${label}${i + 1}`, false)}
									{/each}
								</div>
							</div>
						{:else}
							{@render exerciseCard(block.items[0], true, block.items[0].restSeconds ?? 90, undefined, state === 'active')}
						{/if}
					{/if}
				</div>
			{/each}
		</div>
	{/if}

	<Button variant="secondary" full size="lg" onclick={() => (pickerOpen = true)}>
		<Icon name="plus" size={18} />
		Add exercise
	</Button>

	<div>
		<h2 class="section-label mb-2 px-1">Session details</h2>
		<Card>
			<form
				method="POST"
				action="?/updateSession"
				class="space-y-3"
				use:enhance={() => {
					sessionError = '';
					return async ({ result, update }) => {
						if (result.type === 'failure') {
							sessionError = (result.data?.error as string) ?? 'Could not save';
						}
						await update({ reset: false });
					};
				}}
			>
				<TextField label="Date" name="date" type="date" bind:value={dateValue} required />
				<TextareaField label="Notes" name="notes" placeholder="How did it go?" bind:value={notesValue} rows={2} />
				{#if sessionError}
					<p class="text-sm text-[var(--color-danger)]">{sessionError}</p>
				{/if}
				<Button type="submit" variant="secondary">Save</Button>
			</form>
		</Card>
	</div>
</div>

<ExercisePicker bind:open={pickerOpen} exercises={data.allExercises} onselect={handleExercisePicked} />
<TrainTogetherModal bind:open={trainOpen} partners={data.trainingPartners} />
