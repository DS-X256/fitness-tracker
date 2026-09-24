<script lang="ts">
	// Dose entry in mg OR mcg — GLP-1s and blends are thought of in mg ("2.5 mg tirz", "4 mg KLOW"), most
	// healing peptides in mcg ("250 mcg BPC") — while the form always posts canonical mcg (hidden input),
	// which is what every repository stores. When the value is set from outside (a protocol prefill), the
	// unit follows the amount (≥ 1 mg shows as mg); an empty field starts in `preferMg`'s unit (so typing
	// "2" for a KLOW protocol means 2 mg, not 2 mcg); the user's own toggle choice always wins after that.
	import { parseDecimal } from '$lib/utils/parseDecimal';

	let {
		value = $bindable<number | null>(null),
		label = 'Dose',
		name = 'doseMcg',
		id = 'dose-amount',
		preferMg = false
	}: { value?: number | null; label?: string; name?: string; id?: string; preferMg?: boolean } = $props();

	let unit = $state<'mcg' | 'mg'>('mcg');
	let text = $state('');

	const factor = $derived(unit === 'mg' ? 1000 : 1);

	function fmt(mcg: number, u: 'mcg' | 'mg'): string {
		const n = u === 'mg' ? mcg / 1000 : mcg;
		return String(Math.round(n * 1000) / 1000);
	}
	function parsedMcg(): number | null {
		if (text.trim() === '') return null;
		return Math.round(parseDecimal(text) * factor * 1000) / 1000;
	}

	// External write (prefill) → re-render in a fitting unit. Typing never trips this: the parse of the
	// current text always equals the value the input handler just wrote.
	$effect(() => {
		const v = value;
		const emptyUnit = preferMg ? 'mg' : 'mcg';
		if (v === parsedMcg()) {
			// Still empty (e.g. switched to a compound with no protocol): start in that compound's usual unit.
			if (v == null && text.trim() === '') unit = emptyUnit;
			return;
		}
		if (v == null) {
			text = '';
			unit = emptyUnit;
			return;
		}
		unit = v >= 1000 ? 'mg' : 'mcg';
		text = fmt(v, unit);
	});

	function onInput(e: Event) {
		text = (e.currentTarget as HTMLInputElement).value;
		value = parsedMcg();
	}

	function setUnit(u: 'mcg' | 'mg') {
		if (u === unit) return;
		unit = u;
		// Keep the amount, re-express it: 2500 mcg ⇄ 2.5 mg.
		text = value == null ? '' : fmt(value, u);
	}
</script>

<div>
	<label for={id} class="block text-sm font-medium text-[var(--color-text)] mb-1.5">{label}</label>
	<div class="flex h-11 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] focus-within:ring-2 focus-within:ring-[var(--color-accent)] overflow-hidden">
		<input
			{id}
			type="text"
			inputmode="decimal"
			value={text}
			oninput={onInput}
			placeholder="0"
			class="min-w-0 flex-1 px-3.5 bg-transparent text-[var(--color-text)] focus:outline-none tabular-nums"
		/>
		<div class="flex shrink-0 items-center gap-0.5 pr-1" role="group" aria-label="Dose unit">
			{#each ['mcg', 'mg'] as const as u (u)}
				<button
					type="button"
					onclick={() => setUnit(u)}
					aria-pressed={unit === u}
					class={`h-8 px-2 rounded-[var(--radius-sm,6px)] text-xs font-semibold ${unit === u ? 'bg-[var(--color-accent)] text-[var(--color-on-accent)]' : 'text-[var(--color-text-muted)]'}`}
				>
					{u}
				</button>
			{/each}
		</div>
	</div>
	<input type="hidden" {name} value={value ?? ''} />
</div>
