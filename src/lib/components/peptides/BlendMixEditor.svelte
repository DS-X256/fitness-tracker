<script lang="ts">
	// Editor for a blend's mix — what's in the vial. Enter it the way the label prints it (mg of each
	// component: "GHK-Cu 50 mg, BPC-157 10 mg, …") or as percentages; either way the server derives the
	// other. Shared by the compound form (the blend's default) and the protocol form (a per-protocol mix,
	// since vendors vary). Posts parallel arrays: componentName / componentMg / componentPercent /
	// componentPeptideId, one entry per row, always aligned (the inactive unit posts blanks).
	import NumberField from '$lib/components/NumberField.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import BlendBreakdown from './BlendBreakdown.svelte';
	import {
		BLEND_PRESETS,
		MAX_BLEND_COMPONENTS,
		blendShares,
		formatDose,
		presetComponents,
		splitBlendDose,
		type BlendComponent,
		type BlendPreset
	} from '$lib/utils/peptides';

	type Row = { key: number; name: string; labelMg: number | null; percent: number | null; peptideId: number | null };

	let {
		initial = [],
		vialMg = null,
		previewDoseMcg = null,
		showPresets = true,
		onPreset
	}: {
		/** Rows to start from (read once, when the editor mounts). */
		initial?: BlendComponent[];
		/** Total mg of the vial — for converting % ⇄ mg and the per-vial estimate. */
		vialMg?: number | null;
		/** A dose to preview the split for ("4 mg → …"). */
		previewDoseMcg?: number | null;
		showPresets?: boolean;
		/** Lets the parent also take the preset's name/category/vial size. */
		onPreset?: (preset: BlendPreset) => void;
	} = $props();

	let nextKey = 1;
	function toRows(list: BlendComponent[]): Row[] {
		return list.map((c) => ({
			key: nextKey++,
			name: c.name,
			labelMg: c.labelMg ?? null,
			percent: Number.isFinite(c.percent) && c.percent > 0 ? c.percent : null,
			peptideId: c.peptideId ?? null
		}));
	}

	// svelte-ignore state_referenced_locally — the editor owns its rows after mount; the parent remounts it to reset.
	let rows = $state<Row[]>(toRows(initial));
	// svelte-ignore state_referenced_locally
	let mode = $state<'mg' | 'percent'>(initial.length > 0 && initial.every((c) => c.labelMg != null && c.labelMg > 0) ? 'mg' : initial.length > 0 ? 'percent' : 'mg');

	const asComponents = $derived<BlendComponent[]>(
		rows.map((r) => ({
			name: r.name,
			percent: r.percent ?? 0,
			labelMg: mode === 'mg' ? r.labelMg : null,
			peptideId: r.peptideId
		}))
	);
	const shares = $derived(blendShares(asComponents));
	const mgTotal = $derived(rows.reduce((sum, r) => sum + (r.labelMg ?? 0), 0));
	const pctTotal = $derived(Math.round(rows.reduce((sum, r) => sum + (r.percent ?? 0), 0) * 100) / 100);
	const pctOk = $derived(pctTotal >= 99.5 && pctTotal <= 100.5);
	const preview = $derived(previewDoseMcg && previewDoseMcg > 0 && shares.some((x) => x > 0) ? splitBlendDose(previewDoseMcg, asComponents) : null);

	function applyPreset(preset: BlendPreset) {
		rows = toRows(presetComponents(preset));
		mode = 'mg';
		onPreset?.(preset);
	}
	function addRow() {
		if (rows.length >= MAX_BLEND_COMPONENTS) return;
		rows = [...rows, { key: nextKey++, name: '', labelMg: null, percent: null, peptideId: null }];
	}
	function removeRow(key: number) {
		rows = rows.filter((r) => r.key !== key);
	}
	function switchMode(next: 'mg' | 'percent') {
		if (next === mode) return;
		if (next === 'percent') {
			// mg → %: from the label amounts' own proportions.
			rows = rows.map((r, i) => ({ ...r, percent: shares[i] > 0 ? Math.round(shares[i] * 10000) / 100 : r.percent }));
		} else if (vialMg && vialMg > 0) {
			// % → mg: needs a vial size to scale to.
			rows = rows.map((r) => ({ ...r, labelMg: r.percent != null ? Math.round((r.percent * vialMg) / 100 * 1000) / 1000 : r.labelMg }));
		}
		mode = next;
	}
</script>

<div class="space-y-3">
	{#if showPresets}
		<div class="flex flex-wrap gap-1.5">
			{#each BLEND_PRESETS as preset (preset.name)}
				<Chip onclick={() => applyPreset(preset)}>{preset.name}</Chip>
			{/each}
		</div>
	{/if}

	<div class="flex items-center justify-between">
		<p class="text-xs text-[var(--color-text-muted)]">Enter it the way your vial's label lists it.</p>
		<div class="flex gap-1" role="group" aria-label="Mix entered as">
			<button
				type="button"
				onclick={() => switchMode('mg')}
				aria-pressed={mode === 'mg'}
				class={`h-7 px-2.5 rounded-full text-xs border ${mode === 'mg' ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-text)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
			>
				mg per vial
			</button>
			<button
				type="button"
				onclick={() => switchMode('percent')}
				aria-pressed={mode === 'percent'}
				class={`h-7 px-2.5 rounded-full text-xs border ${mode === 'percent' ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] font-medium text-[var(--color-text)]' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
			>
				%
			</button>
		</div>
	</div>

	<div class="space-y-2">
		{#each rows as row, i (row.key)}
			<div class="flex items-end gap-2">
				<div class="flex-1 min-w-0">
					<input
						type="text"
						name="componentName"
						bind:value={row.name}
						placeholder="e.g. GHK-Cu"
						aria-label={`Component ${i + 1} name`}
						class="w-full h-11 px-3 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
					/>
				</div>
				<input type="hidden" name="componentPeptideId" value={row.peptideId ?? ''} />
				<div class="w-28 shrink-0">
					{#if mode === 'mg'}
						<NumberField id={`component-mg-${row.key}`} name="componentMg" bind:value={row.labelMg} decimalText suffix="mg" />
						<input type="hidden" name="componentPercent" value="" />
					{:else}
						<NumberField id={`component-pct-${row.key}`} name="componentPercent" bind:value={row.percent} decimalText suffix="%" />
						<input type="hidden" name="componentMg" value="" />
					{/if}
				</div>
				<button
					type="button"
					aria-label="Remove component"
					onclick={() => removeRow(row.key)}
					class="h-11 w-10 shrink-0 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
				>
					<Icon name="trash" size={15} />
				</button>
			</div>
		{/each}
	</div>

	<div class="flex items-center justify-between">
		<button type="button" onclick={addRow} class="text-sm text-[var(--color-accent)] font-medium">+ Add component</button>
		{#if rows.length > 0}
			{#if mode === 'mg'}
				<span class="text-xs tabular-nums text-[var(--color-text-muted)]">{Math.round(mgTotal * 1000) / 1000} mg total</span>
			{:else}
				<span class={`text-xs tabular-nums ${pctOk ? 'text-[var(--color-text-muted)]' : 'text-[var(--color-danger)]'}`}>{pctTotal}% total</span>
			{/if}
		{/if}
	</div>

	{#if mode === 'mg' && vialMg && mgTotal > 0 && Math.abs(mgTotal - vialMg) > 0.001}
		<p class="text-xs text-[var(--color-text-muted)]">
			Components add up to {Math.round(mgTotal * 1000) / 1000} mg, not the {vialMg} mg vial size — only the proportions are used to split doses.
		</p>
	{/if}

	{#if preview}
		<div class="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3.5 py-2.5">
			<p class="text-xs font-medium text-[var(--color-text)] mb-0.5">A {formatDose(previewDoseMcg)} dose is recorded as</p>
			<BlendBreakdown portions={preview} />
		</div>
	{/if}
</div>
