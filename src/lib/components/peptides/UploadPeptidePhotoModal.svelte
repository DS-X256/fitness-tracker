<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import SelectField from '$lib/components/SelectField.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import { todayIso } from '$lib/utils/todayIso';

	let {
		open = $bindable(false),
		peptides,
		defaultPeptideId = null
	}: {
		open?: boolean;
		peptides: { id: number; name: string }[];
		defaultPeptideId?: number | null;
	} = $props();

	let preview = $state<string | null>(null);
	let submitting = $state(false);
	let error = $state('');
	let date = $state(todayIso());
	let peptideId = $state('');
	let caption = $state('');

	const peptideOptions = $derived([
		{ value: '', label: 'General (not tied to a compound)' },
		...peptides.map((p) => ({ value: String(p.id), label: p.name }))
	]);

	function onFileChange(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (preview) URL.revokeObjectURL(preview);
		preview = file ? URL.createObjectURL(file) : null;
	}

	function reset() {
		if (preview) URL.revokeObjectURL(preview);
		preview = null;
		error = '';
		date = todayIso();
		peptideId = defaultPeptideId ? String(defaultPeptideId) : '';
		caption = '';
	}

	$effect(() => {
		if (open) peptideId = defaultPeptideId ? String(defaultPeptideId) : '';
	});
</script>

<Modal bind:open title="Add progress photo" onclose={reset}>
	<form
		method="POST"
		action="?/upload"
		enctype="multipart/form-data"
		class="space-y-4"
		use:enhance={() => {
			error = '';
			submitting = true;
			return async ({ result, update }) => {
				submitting = false;
				if (result.type === 'success') {
					open = false;
					reset();
				} else if (result.type === 'failure') {
					error = (result.data?.error as string) ?? 'Could not save photo';
				}
				await update();
			};
		}}
	>
		<div class="flex aspect-[3/4] w-full max-h-64 mx-auto items-center justify-center overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-alt)]">
			{#if preview}
				<img src={preview} alt="" class="h-full w-full object-contain" />
			{:else}
				<Icon name="camera" size={28} class="text-[var(--color-text-muted)]" />
			{/if}
		</div>

		<input
			type="file"
			name="photo"
			accept="image/jpeg,image/png,image/webp"
			onchange={onFileChange}
			required
			class="block w-full text-sm text-[var(--color-text-muted)] file:mr-3 file:h-9 file:rounded-full file:border-0 file:bg-[var(--color-surface-alt)] file:px-3.5 file:text-sm file:font-medium file:text-[var(--color-text)]"
		/>

		<div class="grid grid-cols-2 gap-3">
			<div>
				<label for="pp-date" class="block text-sm font-medium text-[var(--color-text)] mb-1.5">Date</label>
				<input
					id="pp-date"
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
		<p class="text-xs text-[var(--color-text-muted)]">Location and camera metadata are stripped, and the image is encrypted before it's stored.</p>
		<Button type="submit" variant="primary" size="lg" full class="w-full" disabled={submitting}>
			{submitting ? 'Uploading…' : 'Upload photo'}
		</Button>
	</form>
</Modal>
