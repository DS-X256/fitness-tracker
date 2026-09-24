<script lang="ts">
	import Icon from './Icon.svelte';
	import { parseDecimal } from '$lib/utils/parseDecimal';

	let {
		label,
		value = $bindable(0),
		step = 1,
		min = 0,
		class: className = ''
	}: { label: string; value?: number; step?: number; min?: number; class?: string } = $props();

	// Free-text entry (not a native number input) so arbitrary precision and a "," decimal separator both
	// work reliably — native `type="number"` enforces an implicit step of 1 unless "any" is used, and some
	// browsers/keyboards won't accept a typed "," at all. `text` is only re-derived from `value` on button
	// clicks, never while the user is typing, so it never fights their in-progress input.
	let text = $state(String(value));

	// Resync the visible text when `value` is written from OUTSIDE (e.g. a modal reopening on a different
	// dose) — same approach as NumberField: only a disagreement between `value` and the parse of the
	// current text means an external write, so a mid-edit "1," is never clobbered back to "1".
	$effect(() => {
		if (!Object.is(value, parseDecimal(text))) text = String(value);
	});

	function round(n: number) {
		return Math.round(n * 1000) / 1000;
	}

	function handleInput(e: Event) {
		text = (e.currentTarget as HTMLInputElement).value;
		value = parseDecimal(text);
	}

	function dec() {
		value = Math.max(min, round(value - step));
		text = String(value);
	}
	function inc() {
		value = round(value + step);
		text = String(value);
	}
</script>

<div class={className}>
	<span class="block text-xs font-medium text-[var(--color-text-muted)] mb-1.5 text-center">{label}</span>
	<div
		class="flex items-center rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
	>
		<button
			type="button"
			aria-label={`Decrease ${label}`}
			onclick={dec}
			class="h-12 w-11 flex items-center justify-center text-[var(--color-text)] active:bg-[var(--color-surface-alt)] shrink-0"
		>
			<Icon name="minus" size={18} />
		</button>
		<input
			type="text"
			inputmode="decimal"
			value={text}
			oninput={handleInput}
			class="w-full h-12 text-center text-lg font-medium bg-transparent focus:outline-none [appearance:textfield]"
		/>
		<button
			type="button"
			aria-label={`Increase ${label}`}
			onclick={inc}
			class="h-12 w-11 flex items-center justify-center text-[var(--color-text)] active:bg-[var(--color-surface-alt)] shrink-0"
		>
			<Icon name="plus" size={18} />
		</button>
	</div>
</div>
