<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import HintCard from '$lib/components/HintCard.svelte';
	import { todayIso } from '$lib/utils/todayIso';
	import { shiftIsoDate } from '$lib/utils/isoDate';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	const today = todayIso();

	function formatDate(d: string) {
		if (d === today) return 'Today';
		if (d === shiftIsoDate(today, -1)) return 'Yesterday';
		const date = new Date(`${d}T00:00:00`);
		return date.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:head><title>Workouts · Fitness Tracker</title></svelte:head>

<PageHeader title="Workouts">
	{#snippet actions()}
		<Button href="/workouts/plans" variant="ghost" size="md">
			<Icon name="star" size={17} />
			Plans
		</Button>
		<Button href="/exercises" variant="ghost" size="md">
			<Icon name="list" size={17} />
			Exercises
		</Button>
	{/snippet}
</PageHeader>

<div class="mx-auto max-w-md px-4 space-y-4">
	<HintCard id="workouts-intro" icon="dumbbell">
		Start a workout to log sets and weight. Save routines as <strong>Plans</strong>, and set
		goals on <strong>Exercises</strong> to track them from Today.
	</HintCard>

	{#if data.pendingInvites.length > 0}
		<div class="space-y-2">
			{#each data.pendingInvites as invite (invite.memberId)}
				<Card>
					<div class="flex items-center gap-3">
						<span class="h-9 w-9 shrink-0 flex items-center justify-center rounded-full bg-[var(--color-accent-soft)] text-[var(--color-accent)]">
							<Icon name="users" size={18} />
						</span>
						<p class="min-w-0 flex-1 text-sm text-[var(--color-text)]">
							<span class="font-medium">{invite.inviterUsername}</span> invited you to train together
							{#if invite.date}&middot; {formatDate(invite.date)}{/if}
							{#if invite.planName}&middot; {invite.planName}{/if}
						</p>
					</div>
					<div class="mt-3 flex gap-2">
						<form method="POST" action="?/acceptTrainingInvite" use:enhance class="flex-1">
							<input type="hidden" name="memberId" value={invite.memberId} />
							<Button type="submit" variant="primary" size="md" full>
								<Icon name="dumbbell" size={16} />
								Go train with them
							</Button>
						</form>
						<form method="POST" action="?/declineTrainingInvite" use:enhance>
							<input type="hidden" name="memberId" value={invite.memberId} />
							<Button type="submit" variant="ghost" size="md">Decline</Button>
						</form>
					</div>
				</Card>
			{/each}
		</div>
	{/if}

	<form method="POST" action="?/start" use:enhance>
		<Button type="submit" variant="primary" size="lg" full>
			<Icon name="plus" size={20} />
			Start workout
		</Button>
	</form>

	{#if data.sessions.length === 0}
		<EmptyState
			icon="dumbbell"
			title="No workouts yet"
			description="Start your first session — your sets, weights, and progress build up here."
		/>
	{:else}
		<div class="space-y-3">
			{#each data.sessions as session (session.id)}
				<Card href={`/workouts/${session.id}`}>
					<div class="flex items-center justify-between">
						<p class="font-medium text-[var(--color-text)]">{formatDate(session.date)}</p>
						<Icon name="chevron-right" size={18} class="text-[var(--color-text-muted)]" />
					</div>
					<p class="text-sm text-[var(--color-text-muted)] mt-1">
						{session.exerciseCount} {session.exerciseCount === 1 ? 'exercise' : 'exercises'} &middot; {session.setCount}
						{session.setCount === 1 ? 'set' : 'sets'}
					</p>
					{#if session.notes}
						<p class="text-xs text-[var(--color-text-muted)] mt-1 truncate">{session.notes}</p>
					{/if}
				</Card>
			{/each}
		</div>
	{/if}
</div>
