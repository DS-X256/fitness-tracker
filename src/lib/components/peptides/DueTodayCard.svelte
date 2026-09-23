<script lang="ts">
	// "Due today": one row per active protocol with something scheduled, showing today's progress
	// ("1 of 2" on a 2×/day protocol, "this week 1 of 3" on a flexible one), the target dose (loading/taper
	// aware) and, for a blend, what that dose splits into. Log = one tap at today's target; Adjust = the
	// full form prefilled; Skip = a deliberate skip so adherence says "skipped", not "missed".
	import { enhance } from '$app/forms';
	import Card from '$lib/components/Card.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import BlendBreakdown from './BlendBreakdown.svelte';
	import { formatDose } from '$lib/utils/peptides';
	import { nowHm, todayIso } from '$lib/utils/todayIso';
	import type { TodayState } from '$lib/utils/peptideAdherence';
	import type { BlendPortion } from '$lib/utils/peptides';
	import type { DosePhase } from '$lib/utils/peptideSchedule';

	type Row = {
		protocolId: number;
		peptideId: number;
		peptideName: string;
		state: TodayState;
		done: boolean;
		phase: DosePhase;
		timeOfDay: string | null;
		schedule: string;
		split: BlendPortion[] | null;
	};

	let {
		rows,
		title = 'Due today',
		onAdjust
	}: { rows: Row[]; title?: string; onAdjust: (row: Row) => void } = $props();

	let error = $state('');
	let busy = $state<string | null>(null);

	function progress(s: TodayState): string | null {
		if (s.mode === 'weekly') return `This week ${s.taken} of ${s.target}`;
		if (s.slots > 1) return `${s.taken} of ${s.slots}${s.skipped ? ` · ${s.skipped} skipped` : ''}`;
		return null;
	}

	function submitWithClock(key: string) {
		return ({ formData }: { formData: FormData }) => {
			formData.set('clientDate', todayIso());
			formData.set('clientTime', nowHm());
			busy = key;
			error = '';
			return async ({ result, update }: { result: { type: string; data?: Record<string, unknown> }; update: () => Promise<void> }) => {
				busy = null;
				if (result.type === 'failure') error = typeof result.data?.error === 'string' ? result.data.error : 'Something went wrong';
				await update();
			};
		};
	}
</script>

{#if rows.length > 0}
	<div>
		<h2 class="section-label mb-2 px-1">{title}</h2>
		<Card padded={false} class="divide-y divide-[var(--color-border)]">
			{#each rows as d (d.protocolId)}
				<div class="px-4 py-3">
					<div class="flex items-center gap-3">
						<a href={`/peptides/${d.peptideId}`} class="flex-1 min-w-0">
							<p class="text-sm font-medium text-[var(--color-text)] truncate">
								{d.peptideName}
								{#if d.phase === 'loading'}<span class="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)] align-middle">Loading</span>{/if}
								{#if d.phase === 'taper'}<span class="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)] align-middle">Tapering</span>{/if}
							</p>
							<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
								{formatDose(d.state.targetMcg)}{#if d.timeOfDay} · {d.timeOfDay}{/if}{#if progress(d.state)} · {progress(d.state)}{/if}
							</p>
						</a>
						{#if d.done}
							<span class="flex items-center gap-1 text-xs font-medium text-[var(--color-success)]">
								<Icon name="check" size={16} />
								{d.state.skipped > 0 && d.state.taken === 0 ? 'Skipped' : 'Done'}
							</span>
						{:else}
							<div class="flex items-center gap-1">
								<form method="POST" action="/peptides?/skipDose" use:enhance={submitWithClock(`skip-${d.protocolId}`)}>
									<input type="hidden" name="protocolId" value={d.protocolId} />
									<button
										type="submit"
										disabled={busy != null}
										class="h-9 px-2.5 rounded-[var(--radius-md)] text-xs font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
									>
										Skip
									</button>
								</form>
								<button
									type="button"
									onclick={() => onAdjust(d)}
									class="h-9 px-2.5 rounded-[var(--radius-md)] text-xs font-medium text-[var(--color-text)] border border-[var(--color-border)] hover:bg-[var(--color-surface-alt)]"
								>
									Adjust
								</button>
								<form method="POST" action="/peptides?/quickLog" use:enhance={submitWithClock(`log-${d.protocolId}`)}>
									<input type="hidden" name="protocolId" value={d.protocolId} />
									<button
										type="submit"
										disabled={busy != null}
										class="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-medium active:scale-[0.98] disabled:opacity-60"
									>
										{busy === `log-${d.protocolId}` ? '…' : 'Log'}
									</button>
								</form>
							</div>
						{/if}
					</div>
					{#if d.split}<BlendBreakdown portions={d.split} class="mt-1" />{/if}
				</div>
			{/each}
		</Card>
		{#if error}<p class="mt-1.5 px-1 text-sm text-[var(--color-danger)]">{error}</p>{/if}
	</div>
{/if}
