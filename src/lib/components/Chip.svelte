<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		selected = false,
		onclick,
		children,
		class: className = ''
	}: { selected?: boolean; onclick?: () => void; children: Snippet; class?: string } = $props();
</script>

<button
	type="button"
	{onclick}
	class={`h-9 px-3.5 rounded-[var(--radius-pill)] text-sm font-medium whitespace-nowrap transition-colors border ${
		selected
			? 'bg-[var(--color-accent)] border-[var(--color-accent)] text-[var(--color-on-accent)]'
			: 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]'
	} ${className}`}
>
	{@render children()}
</button>
