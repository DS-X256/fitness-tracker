<script lang="ts">
	import { enhance } from '$app/forms';
	import Modal from '$lib/components/Modal.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { TrainingPartner } from '$lib/server/repositories/workoutGroups';

	let { open = $bindable(false), partners }: { open?: boolean; partners: TrainingPartner[] } = $props();

	let username = $state('');
	let inviteError = $state('');
</script>

<Modal bind:open title="Train together">
	<div class="space-y-2">
		{#each partners as partner (partner.memberId)}
			<div class="flex items-center justify-between gap-2">
				<span class="min-w-0 text-sm text-[var(--color-text)]">
					{partner.username}
					<span class="text-[var(--color-text-muted)]">
						&middot; {partner.status === 'invited' ? 'Invited, not started yet' : `${partner.setCount} ${partner.setCount === 1 ? 'set' : 'sets'} logged`}
					</span>
				</span>
				<form method="POST" action="?/removeTrainingMember" use:enhance>
					<input type="hidden" name="memberId" value={partner.memberId} />
					<Button type="submit" variant="ghost" size="md">Remove</Button>
				</form>
			</div>
		{:else}
			<p class="text-sm text-[var(--color-text-muted)]">Nobody's training with you on this one yet.</p>
		{/each}
	</div>

	<form
		method="POST"
		action="?/inviteToTrain"
		class="mt-4 space-y-3 border-t border-[var(--color-border)] pt-4"
		use:enhance={() => {
			inviteError = '';
			return async ({ result, update }) => {
				if (result.type === 'success') {
					username = '';
				} else if (result.type === 'failure') {
					inviteError = (result.data as { error?: string } | undefined)?.error ?? 'Could not send invite';
				}
				await update({ reset: false });
			};
		}}
	>
		<div class="flex items-end gap-2">
			<TextField label="Invite by username" name="username" bind:value={username} placeholder="e.g. anna" class="flex-1" />
			<Button type="submit" variant="primary" size="icon">
				<Icon name="plus" size={20} />
				<span class="sr-only">Invite</span>
			</Button>
		</div>
	</form>
	{#if inviteError}
		<p class="mt-2 text-sm text-[var(--color-danger)]">{inviteError}</p>
	{/if}
</Modal>
