<script lang="ts" generics="Row extends HistoryRow">
	// Dose history rows: compound (linked to its hub), amount, blend split, side-effect chips, and the
	// skip/prime/removal markers — plus edit, delete and a quick "how did it go?" check-in that sets side
	// effects without reopening the whole dose form.
	import { enhance } from '$app/forms';
	import Card from '$lib/components/Card.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import Modal from '$lib/components/Modal.svelte';
	import Button from '$lib/components/Button.svelte';
	import BlendBreakdown from './BlendBreakdown.svelte';
	import EffectsPicker from './EffectsPicker.svelte';
	import { effectLabel, formatDose, siteLabel, SEVERITY_LABELS, type DoseEffect, type DoseKind } from '$lib/utils/peptides';

	import type { HistoryRow } from './historyRow';

	let {
		rows,
		onEdit,
		showCompound = true,
		/** When listing one compound's history, a row that came from a blend (not logged as this compound). */
		viaBlend
	}: {
		rows: Row[];
		onEdit: (row: Row) => void;
		showCompound?: boolean;
		viaBlend?: (row: Row) => { mcg: number } | null;
	} = $props();

	let effectsFor = $state<Row | null>(null);
	let effectsOpen = $state(false);
	let effectsDraft = $state<DoseEffect[]>([]);
	let effectsError = $state('');

	function openEffects(r: Row) {
		effectsFor = r;
		effectsDraft = r.effects.map((e) => ({ ...e }));
		effectsError = '';
		effectsOpen = true;
	}

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function kindLabel(k: DoseKind): string | null {
		return k === 'prime' ? 'Priming' : k === 'remove' ? 'Removed' : k === 'skip' ? 'Skipped' : null;
	}
</script>

<Card padded={false} class="divide-y divide-[var(--color-border)]">
	{#each rows as dose (dose.id)}
		{@const via = viaBlend?.(dose) ?? null}
		<div class="flex items-start gap-2 px-4 py-2.5">
			<div class="flex-1 min-w-0">
				<p class="text-sm text-[var(--color-text)] truncate">
					{#if showCompound}<a href={`/peptides/${dose.peptideId}`} class="hover:text-[var(--color-accent)]">{dose.peptideName}</a>{/if}
					{#if dose.kind === 'skip'}
						<span class="text-[var(--color-text-muted)]">{showCompound ? ' · ' : ''}Skipped</span>
					{:else if via}
						<span class="tabular-nums">{formatDose(via.mcg)}</span>
						<span class="text-[var(--color-text-muted)]"> via {dose.peptideName} ({formatDose(dose.doseMcg)})</span>
					{:else}
						<span class="{showCompound ? 'text-[var(--color-text-muted)]' : ''} tabular-nums">{showCompound ? ' · ' : ''}{formatDose(dose.doseMcg)}</span>
					{/if}
				</p>
				<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
					{fmtDate(dose.date)}{#if dose.time}{' · '}{dose.time}{/if}{#if dose.site}{' · '}{siteLabel(dose.site)}{/if}{#if dose.kind !== 'dose' && dose.kind !== 'skip'}{' · '}{kindLabel(dose.kind)}{/if}
				</p>
				{#if dose.split && !via}<BlendBreakdown portions={dose.split} estimated={dose.splitEstimated} linkable class="mt-0.5" />{/if}
				{#if dose.effects.length > 0}
					<div class="mt-1 flex flex-wrap gap-1">
						{#each dose.effects as e (e.tag)}
							<span class="rounded-full bg-[var(--color-surface-alt)] px-2 py-0.5 text-[11px] text-[var(--color-text)]">
								{effectLabel(e.tag)}{e.severity > 1 ? ` · ${SEVERITY_LABELS[e.severity].toLowerCase()}` : ''}
							</span>
						{/each}
					</div>
				{/if}
			</div>
			{#if dose.kind === 'dose' && !via}
				<button
					type="button"
					aria-label="Side effects"
					title="How did it go?"
					onclick={() => openEffects(dose)}
					class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
				>
					<Icon name="health" size={15} />
				</button>
			{/if}
			{#if !via}
				<button
					type="button"
					aria-label="Edit dose"
					onclick={() => onEdit(dose)}
					class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
				>
					<Icon name="edit" size={15} />
				</button>
				<form method="POST" action="/peptides?/deleteDose" use:enhance>
					<input type="hidden" name="id" value={dose.id} />
					<button
						type="submit"
						aria-label="Delete dose"
						class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
					>
						<Icon name="x" size={16} />
					</button>
				</form>
			{/if}
		</div>
	{/each}
</Card>

<Modal bind:open={effectsOpen} title="How did it go?">
	{#if effectsFor}
		<form
			method="POST"
			action="/peptides?/setDoseEffects"
			class="space-y-4"
			use:enhance={() => async ({ result, update }) => {
				if (result.type === 'success') effectsOpen = false;
				else if (result.type === 'failure') effectsError = String(result.data?.error ?? 'Could not save');
				await update({ reset: false });
			}}
		>
			<input type="hidden" name="id" value={effectsFor.id} />
			<p class="text-sm text-[var(--color-text-muted)]">
				{effectsFor.peptideName} · {formatDose(effectsFor.doseMcg)} · {fmtDate(effectsFor.date)}
			</p>
			<EffectsPicker bind:value={effectsDraft} />
			{#if effectsError}<p class="text-sm text-[var(--color-danger)]">{effectsError}</p>{/if}
			<Button type="submit" variant="primary" full class="w-full">Save</Button>
		</form>
	{/if}
</Modal>
