<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Button from '$lib/components/Button.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import { todayIso } from '$lib/utils/todayIso';

	let {
		open = $bindable(false),
		photo,
		peptides
	}: {
		open?: boolean;
		photo: { id: number; date: string; peptideId: number | null; caption: string | null } | null;
		peptides: { id: number; name: string }[];
	} = $props();

	let submitting = $state(false);
	let error = $state('');
	let date = $state(todayIso());
	let peptideId = $state('');
	let caption = $state('');

	const peptideOptions = $derived([
		{ value: '', label: 'General (not tied to a compound)' },
		...peptides.map((p) => ({ value: String(p.id), label: p.name }))
	]);

	// Re-seed the form fields whenever a different photo is opened for editing.
	$effect(() => {
		if (open && photo) {
			date = photo.date;
			peptideId = photo.peptideId ? String(photo.peptideId) : '';
			caption = photo.caption ?? '';
			error = '';
		}
	});
</script>

<Modal bind:open title="Edit progress photo">
	{#if photo}
		<form
			method="POST"
			action="?/update"
			class="space-y-4"
			use:enhance={() => {
				error = '';
				submitting = true;
				return async ({ result, update }) => {
					submitting = false;
					if (result.type === 'success') {
						open = false;
					} else if (result.type === 'failure') {
						error = (result.data?.error as string) ?? 'Could not update photo';
					}
					await update();
				};
			}}
		>
			<input type="hidden" name="id" value={photo.id} />

			<img
				src={`/peptides/photos/${photo.id}/file`}
				alt=""
				class="mx-auto aspect-[3/4] max-h-64 w-full rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] object-contain"
			/>

			<div class="grid grid-cols-2 gap-3">
				<div>
					<label for="pp-edit-date" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Date</label>
					<input
						id="pp-edit-date"
						type="date"
						name="date"
						bind:value={date}
						max={todayIso()}
						class="w-full h-11 px-3.5 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)] focus:border-transparent"
					/>
				</div>
				<SelectField label="Compound" name="peptideId" bind:value={peptideId} options={peptideOptions} />
			</div>

			<TextField label="Caption (optional)" name="caption" bind:value={caption} placeholder="e.g. week 6, injection site" />

			{#if error}
				<p class="text-sm text-[var(--color-danger)]">{error}</p>
			{/if}
			<Button type="submit" variant="primary" size="lg" full class="w-full" disabled={submitting}>
				{submitting ? 'Saving…' : 'Save changes'}
			</Button>
		</form>
	{/if}
</Modal>
