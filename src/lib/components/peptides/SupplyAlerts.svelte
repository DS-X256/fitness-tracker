<script lang="ts">
	// Containers that need attention: expired / expiring soon, or running low on the user's own schedule
	// (schedule-aware run-out date, not the old "remaining ÷ one dose = days").
	import Card from '$lib/components/Card.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import { CONTAINER_FORM_LABELS, MEASURE_UNIT_LABELS, type ContainerForm, type MeasureUnit } from '$lib/utils/peptides';

	type Row = {
		id: number;
		peptideId: number;
		peptideName: string;
		form: ContainerForm;
		vialMg: number | null;
		expiresAt: string | null;
		expiry: 'expired' | 'soon' | null;
		expiresInDays: number | null;
		dosesLeft: number | null;
		unit: MeasureUnit | 'dose';
		projection: { daysLeft: number | null; runsOutOn: string | null } | null;
		low: boolean;
	};

	let { rows }: { rows: Row[] } = $props();

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function leftLabel(r: Row): string | null {
		if (r.dosesLeft == null) return null;
		const unit = r.unit === 'dose' ? (r.dosesLeft === 1 ? 'dose' : 'doses') : MEASURE_UNIT_LABELS[r.unit];
		return `~${r.dosesLeft} ${unit} left`;
	}
</script>

{#if rows.length > 0}
	<div>
		<h2 class="section-label mb-2 px-1">Supply needing attention</h2>
		<Card padded={false} class="divide-y divide-[var(--color-border)]">
			{#each rows as v (v.id)}
				<a href={`/peptides/${v.peptideId}`} class="flex items-center gap-3 px-4 py-3">
					<div class="mt-0.5 shrink-0 text-[var(--color-danger)]"><Icon name="alert" size={18} /></div>
					<div class="flex-1 min-w-0 text-sm">
						<p class="text-[var(--color-text)] truncate">
							{v.peptideName}{#if v.form === 'vial' && v.vialMg} · {v.vialMg} mg vial{:else if v.form !== 'vial'} · {CONTAINER_FORM_LABELS[v.form]}{/if}
						</p>
						<p class="text-xs text-[var(--color-text-muted)]">
							{#if v.expiry === 'expired'}Expired {fmtDate(v.expiresAt!)}{:else if v.expiry === 'soon'}Expires {fmtDate(v.expiresAt!)}{/if}
							{#if v.expiry && v.low} · {/if}
							{#if v.low}
								{leftLabel(v) ?? ''}{#if v.projection?.runsOutOn}{leftLabel(v) ? ' · ' : ''}runs out ~{fmtDate(v.projection.runsOutOn)}{/if}
							{/if}
						</p>
					</div>
					<Icon name="chevron-right" size={16} />
				</a>
			{/each}
		</Card>
	</div>
{/if}
