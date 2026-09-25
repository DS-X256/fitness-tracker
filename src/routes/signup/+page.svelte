<script lang="ts">
	import Button from '$lib/components/Button.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import type { ActionData } from './$types';

	let { form }: { form: ActionData } = $props();
	let username = $state(form?.username ?? '');
	let password = $state('');
	let confirmPassword = $state('');
</script>

<svelte:head><title>Create account · Fitness Tracker</title></svelte:head>

<div class="min-h-dvh flex flex-col items-center justify-center px-6 bg-[var(--color-bg)]">
	<div class="w-full max-w-xs">
		<div class="text-center mb-8">
			<div
				class="mx-auto mb-4 h-14 w-14 rounded-[var(--radius-lg)] bg-[var(--color-accent)] flex items-center justify-center text-[var(--color-on-accent)] text-2xl font-heading font-semibold"
			>
				F
			</div>
			<h1 class="text-2xl text-[var(--color-text)]">Create your account</h1>
			<p class="text-sm text-[var(--color-text-muted)] mt-1">Your meals, list, and workouts — private to you</p>
		</div>

		<form method="POST" class="space-y-4">
			<TextField
				label="Username"
				name="username"
				bind:value={username}
				required
				hint="3-24 characters: letters, numbers, _ or -"
			/>
			<TextField label="Password" name="password" type="password" bind:value={password} required hint="At least 8 characters" />
			<TextField label="Confirm password" name="confirmPassword" type="password" bind:value={confirmPassword} required />
			{#if form?.error}
				<p class="text-sm text-[var(--color-danger)]">{form.error}</p>
			{/if}
			<Button type="submit" variant="primary" full size="lg">Create account</Button>
		</form>

		<p class="mt-5 text-center text-sm text-[var(--color-text-muted)]">
			Already have an account? <a href="/login" class="text-[var(--color-accent)] font-medium">Sign in</a>
		</p>
	</div>
</div>
