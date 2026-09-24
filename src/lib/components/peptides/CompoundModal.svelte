<script lang="ts">
	// Add/edit a compound. Marking it a blend reveals the mix editor; saving links every component to its
	// own compound (created if needed) so blend doses count as GHK-Cu/BPC-157/… intake everywhere.
	import { enhance } from '$app/forms';
	import { untrack } from 'svelte';
	import Modal from '$lib/components/Modal.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import TextareaField from '$lib/components/TextareaField.svelte';
	import Button from '$lib/components/Button.svelte';
	import BlendMixEditor from './BlendMixEditor.svelte';
	import {
		PEPTIDE_CATEGORIES,
		formatHalfLife,
		suggestHalfLifeHours,
		type BlendComponent,
		type BlendPreset,
		type PeptideCategory
	} from '$lib/utils/peptides';

	type Compound = {
		id: number;
		name: string;
		category: PeptideCategory | null;
		vialMg: number | null;
		notes: string | null;
		isBlend: boolean;
		components: BlendComponent[] | null;
		halfLifeHours: number | null;
	};

	let { open = $bindable(false), compound = null }: { open?: boolean; compound?: Compound | null } = $props();

	let name = $state('');
	let category = $state('');
	let vialMg = $state<number | null>(null);
	let notes = $state('');
	let isBlend = $state(false);
	let halfLifeHours = $state<number | null>(null);
	let error = $state('');
	let editorKey = $state(0);
	let editorInitial = $state<BlendComponent[]>([]);

	let wasOpen = false;
	$effect(() => {
		const isOpen = open;
		if (isOpen && !wasOpen) untrack(init);
		wasOpen = isOpen;
	});
	function init() {
		name = compound?.name ?? '';
		category = compound?.category ?? '';
		vialMg = compound?.vialMg ?? null;
		notes = compound?.notes ?? '';
		isBlend = compound?.isBlend ?? false;
		halfLifeHours = compound?.halfLifeHours ?? null;
		autoFilled = null;
		editorInitial = compound?.components ?? [];
		editorKey++;
		error = '';
	}

	function onPreset(preset: BlendPreset) {
		if (!name.trim()) name = preset.name;
		category = preset.category;
		vialMg = preset.vialMg;
	}

	const suggestedHalfLife = $derived(isBlend ? null : suggestHalfLifeHours(name));

	/** Adding a new compound with a known name fills its standard half-life (so its "active in body" graph
	 *  just works) — but only while the field holds nothing or the previous auto-fill, never over a value
	 *  the user typed. Editing an existing compound keeps the explicit "Use it" hint instead. */
	let autoFilled: number | null = null;
	function onNameInput(e: Event) {
		if (compound || isBlend) return;
		if (halfLifeHours != null && halfLifeHours !== autoFilled) return;
		// Read the typed value directly — don't depend on bind:value having updated `name` first.
		const suggestion = suggestHalfLifeHours((e.currentTarget as HTMLInputElement).value);
		halfLifeHours = suggestion;
		autoFilled = suggestion;
	}
	const inputClass =
		'w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]';
</script>

<Modal bind:open title={compound ? 'Edit compound' : 'Add compound'}>
	<form
		method="POST"
		action="/peptides/manage?/savePeptide"
		class="space-y-4"
		use:enhance={() => async ({ result, update }) => {
			if (result.type === 'success') open = false;
			else if (result.type === 'failure') error = String(result.data?.error ?? 'Could not save');
			await update({ reset: false });
		}}
	>
		<input type="hidden" name="id" value={compound?.id ?? ''} />
		<div>
			<label for="p-name" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Name</label>
			<input
				id="p-name"
				name="name"
				bind:value={name}
				oninput={onNameInput}
				required
				placeholder={isBlend ? 'e.g. KLOW' : 'e.g. BPC-157'}
				class={inputClass}
			/>
		</div>
		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="p-cat" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Category</label>
				<select id="p-cat" name="category" bind:value={category} class={inputClass}>
					<option value="">Uncategorized</option>
					{#each PEPTIDE_CATEGORIES as c (c.value)}<option value={c.value}>{c.label}</option>{/each}
				</select>
			</div>
			<NumberField label="Usual vial size" name="vialMg" bind:value={vialMg} decimalText suffix="mg" />
		</div>

		<div class="rounded-[var(--radius-md)] border border-[var(--color-border)] px-3.5 py-2.5">
			<label class="flex items-center gap-2.5 text-sm text-[var(--color-text)]">
				<input type="checkbox" name="isBlend" bind:checked={isBlend} class="h-4 w-4 accent-[var(--color-accent)]" />
				This is a blend (several compounds in one vial)
			</label>
			{#if isBlend}
				<p class="text-xs text-[var(--color-text-muted)] mt-1.5 mb-3">
					Logging a dose of the blend records each component's share — e.g. 4 mg KLOW counts as GHK-Cu, BPC-157, TB-500
					and KPV in your history, levels and AI summaries. Pick a common blend to start, then match your vial's label
					(vendors vary). A protocol can override this mix.
				</p>
				{#key editorKey}
					<BlendMixEditor initial={editorInitial} {vialMg} previewDoseMcg={vialMg ? vialMg * 50 : 4000} {onPreset} />
				{/key}
			{/if}
		</div>

		{#if !isBlend}
			<div>
				<NumberField label="Half-life (optional)" name="halfLifeHours" bind:value={halfLifeHours} decimalText suffix="hours" />
				<p class="text-xs text-[var(--color-text-muted)] mt-1.5">
					Powers the "active in body" estimate — a rough decay curve from your logged doses (blend doses included), not
					dosing guidance.
					{#if suggestedHalfLife != null && halfLifeHours !== suggestedHalfLife}
						Standard for {name.trim()} is ~{formatHalfLife(suggestedHalfLife)}
						<button type="button" onclick={() => (halfLifeHours = suggestedHalfLife)} class="text-[var(--color-accent)] font-medium">Use it</button>.
					{/if}
				</p>
			</div>
		{:else}
			<input type="hidden" name="halfLifeHours" value="" />
		{/if}
		<TextareaField label="Notes" name="notes" bind:value={notes} rows={2} placeholder="Optional" />
		{#if error}<p class="text-sm text-[var(--color-danger)]">{error}</p>{/if}
		<Button type="submit" variant="primary" full class="w-full">Save</Button>
	</form>
</Modal>
