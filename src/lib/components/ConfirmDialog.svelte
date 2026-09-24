<script lang="ts">
	// A small confirm-before-destroy dialog. The destructive action itself is the caller's form (so it
	// stays a real SvelteKit form action with progressive enhancement); this only gates it.
	import type { Snippet } from 'svelte';
	import Modal from './Modal.svelte';

	let {
		open = $bindable(false),
		title,
		children,
		actions
	}: {
		open?: boolean;
		title: string;
		/** The explanation — what will be lost. */
		children: Snippet;
		/** The buttons/forms (confirm, and any safer alternative). A "Cancel" is always added. */
		actions: Snippet;
	} = $props();
</script>

<Modal bind:open {title}>
	<div class="space-y-4">
		<div class="text-sm leading-relaxed text-[var(--color-text)]">{@render children()}</div>
		<div class="flex flex-col gap-2">
			{@render actions()}
			<button
				type="button"
				onclick={() => (open = false)}
				class="h-11 w-full rounded-[var(--radius-md)] text-sm font-medium text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
			>
				Cancel
			</button>
		</div>
	</div>
</Modal>
