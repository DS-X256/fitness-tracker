<script lang="ts">
	import { enhance } from '$app/forms';
	import { celebrate } from '$lib/utils/kitten';
	import NumberStepper from '$lib/components/NumberStepper.svelte';
	import Icon from '$lib/components/Icon.svelte';

	let {
		exerciseId,
		label,
		initialReps = 0,
		initialWeight = 0,
		onLogged
	}: {
		exerciseId: number;
		label?: string;
		initialReps?: number;
		initialWeight?: number;
		onLogged?: () => void;
	} = $props();

	// Local state only — deliberately never reset from server data after a submit, so
	// logging an identical set again is just tapping the check button once more.
	let reps = $state(initialReps);
	let weight = $state(initialWeight);
	let submitting = $state(false);
	let justAdded = $state(false);
	let flashTimeout: ReturnType<typeof setTimeout> | undefined;
	let errorMsg = $state('');
</script>

<div>
	{#if label}
		<p class="mb-1 text-xs font-medium text-[var(--color-text-muted)]">{label}</p>
	{/if}
	<form
		method="POST"
		action="?/addSet"
		class="flex items-end gap-2"
		use:enhance={() => {
			submitting = true;
			errorMsg = '';
			return async ({ result, update }) => {
				submitting = false;
				if (result.type === 'success') {
					justAdded = true;
					clearTimeout(flashTimeout);
					flashTimeout = setTimeout(() => (justAdded = false), 1000);
					onLogged?.();
					celebrate();
				} else if (result.type === 'failure') {
					errorMsg = (result.data?.error as string) ?? 'Could not log set';
				}
				await update({ reset: false });
			};
		}}
	>
		<input type="hidden" name="exerciseId" value={exerciseId} />
		<input type="hidden" name="reps" value={reps} />
		<input type="hidden" name="weight" value={weight} />
		<NumberStepper label="Reps" bind:value={reps} step={1} min={0} class="flex-1" />
		<NumberStepper label="Weight (kg)" bind:value={weight} step={2.5} min={0} class="flex-1" />
		<button
			type="submit"
			aria-label="Log set"
			disabled={submitting}
			class={`h-12 w-12 shrink-0 flex items-center justify-center rounded-[var(--radius-md)] text-[var(--color-on-accent)] transition-colors disabled:opacity-60 ${
				justAdded
					? 'bg-[var(--color-success)]'
					: 'bg-[var(--color-accent)] hover:bg-[var(--color-accent-hover)]'
			}`}
		>
			<Icon name="check" size={20} />
		</button>
	</form>
	{#if errorMsg}
		<p class="mt-1.5 text-sm text-[var(--color-danger)]">{errorMsg}</p>
	{/if}
</div>
