<script lang="ts">
	import { enhance } from '$app/forms';
	import Icon from '$lib/components/Icon.svelte';
	import Button from '$lib/components/Button.svelte';
	import type { Snippet } from 'svelte';

	type Insight = { content: string; model: string; generatedAt: Date };

	let {
		title,
		disclosure,
		action,
		insight = null,
		aiAvailable,
		buttonLabel = 'Generate insight',
		disabled = false,
		disabledMessage,
		extra
	}: {
		title: string;
		/** One-line disclosure of what leaves the server when the button is pressed. */
		disclosure: string;
		/** Form action, e.g. "?/generateDigest". */
		action: string;
		insight?: Insight | null;
		aiAvailable: boolean;
		buttonLabel?: string;
		/** True when the feature is available but deliberately not offered right now (e.g. peptide
		 *  insights toggled off) — shows `disabledMessage` instead of the generate control. */
		disabled?: boolean;
		disabledMessage?: string;
		/** Extra content rendered above the generate control (e.g. an opt-in toggle). */
		extra?: Snippet;
	} = $props();

	// Seeded from the initial load; owned locally once the form's own enhance callback resolves — same
	// "capture the initial value, then own it" pattern as TargetsModal.svelte elsewhere in this app.
	let current = $state<Insight | null>(insight);
	let loading = $state(false);
	let error = $state('');

	function relativeTime(date: Date): string {
		const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000));
		if (seconds < 60) return 'just now';
		const minutes = Math.round(seconds / 60);
		if (minutes < 60) return `${minutes}m ago`;
		const hours = Math.round(minutes / 60);
		if (hours < 24) return `${hours}h ago`;
		return `${Math.round(hours / 24)}d ago`;
	}
</script>

<section class="rounded-[var(--radius-lg)] border border-[var(--color-border)] bg-[var(--color-surface)] p-3.5 space-y-3">
	<div class="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-accent)]">
		<Icon name="sparkles" size={14} />
		{title}
	</div>

	{#if extra}{@render extra()}{/if}

	{#if !aiAvailable}
		<p class="text-sm text-[var(--color-text-muted)]">AI features aren't configured on this server.</p>
	{:else if disabled}
		<p class="text-sm text-[var(--color-text-muted)]">{disabledMessage}</p>
	{:else}
		{#if current}
			<p class="text-sm text-[var(--color-text)] whitespace-pre-line">{current.content}</p>
			<p class="text-xs text-[var(--color-text-muted)]">Generated {relativeTime(current.generatedAt)}</p>
		{/if}

		{#if error}
			<p class="text-xs text-[var(--color-danger)]">{error}</p>
		{/if}

		<form
			method="POST"
			{action}
			use:enhance={() => {
				loading = true;
				error = '';
				return async ({ result, update }) => {
					loading = false;
					if (result.type === 'success' && result.data?.insight) {
						const next = result.data.insight as Insight;
						current = { ...next, generatedAt: new Date(next.generatedAt) };
					} else if (result.type === 'failure' && result.data?.error) {
						error = String(result.data.error);
					}
					await update({ reset: false });
				};
			}}
		>
			<Button type="submit" variant="secondary" size="md" disabled={loading}>
				<Icon name="sparkles" size={16} />
				{loading ? 'Generating…' : current ? 'Regenerate' : buttonLabel}
			</Button>
			<p class="mt-1.5 text-[0.6875rem] text-[var(--color-text-muted)]">{disclosure}</p>
		</form>
	{/if}
</section>
