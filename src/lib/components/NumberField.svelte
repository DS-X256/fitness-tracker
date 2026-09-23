<script lang="ts">
	import { parseDecimal } from '$lib/utils/parseDecimal';

	let {
		label,
		name,
		value = $bindable<number | null>(null),
		step = 1,
		min,
		placeholder = '',
		required = false,
		suffix = '',
		decimalText = false,
		id: idProp,
		class: className = ''
	}: {
		label?: string;
		name: string;
		value?: number | null;
		step?: number;
		min?: number;
		placeholder?: string;
		required?: boolean;
		suffix?: string;
		/** Renders a free-text decimal input (accepts "," or "." as the separator, any precision) instead of
		 * a native number input — for values like workout weight where exact entry matters more than native
		 * step validation, which caps precision and can reject a typed "," outright. */
		decimalText?: boolean;
		/** Explicit element id — needed when the same `name` repeats on one page (e.g. per-row inputs). */
		id?: string;
		class?: string;
	} = $props();

	const id = $derived(idProp ?? `field-${name}`);
	let text = $state(value == null ? '' : String(value));

	// Resyncs the visible text when `value` changes from OUTSIDE this input (e.g. a parent programmatically
	// setting the bound value, like a "use the standard amount" suggestion button) — but not on every
	// keystroke, since a mid-edit string like "1." parses to 1 and would otherwise get clobbered back to "1"
	// as the user types the fraction. Comparing against the parse of the current text tells the two apart:
	// only an external change makes them disagree.
	$effect(() => {
		if (value !== (text.trim() === '' ? null : parseDecimal(text))) {
			text = value == null ? '' : String(value);
		}
	});

	function handleTextInput(e: Event) {
		const raw = (e.currentTarget as HTMLInputElement).value;
		text = raw;
		value = raw.trim() === '' ? null : parseDecimal(raw);
	}
</script>

<div class={className}>
	{#if label}
		<label for={id} class="block text-sm font-medium text-[var(--color-text)] mb-1.5">{label}</label>
	{/if}
	<div class="relative">
		{#if decimalText}
			<input type="hidden" {name} value={value ?? ''} />
			<input
				{id}
				type="text"
				inputmode="decimal"
				{placeholder}
				{required}
				value={text}
				oninput={handleTextInput}
				class="w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
			/>
		{:else}
			<input
				{id}
				{name}
				type="number"
				inputmode="decimal"
				{step}
				{min}
				{placeholder}
				{required}
				bind:value
				class="w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
			/>
		{/if}
		{#if suffix}
			<span
				class="pointer-events-none absolute right-3.5 top-1/2 -translate-y-1/2 text-sm text-[var(--color-text-muted)]"
				>{suffix}</span
			>
		{/if}
	</div>
</div>
