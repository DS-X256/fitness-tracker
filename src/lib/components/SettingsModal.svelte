<script lang="ts">
	import { page } from '$app/state';
	import Modal from './Modal.svelte';
	import Icon from './Icon.svelte';
	import { THEMES, getTheme, setTheme, type Theme, type ThemeGroup } from '$lib/utils/theme';

	let { open = $bindable(false) }: { open?: boolean } = $props();

	const isAdmin = $derived(page.data.user?.isAdmin ?? false);

	let theme = $state<Theme>('system');

	// Sync the control with the persisted value whenever the sheet opens.
	$effect(() => {
		if (open) theme = getTheme();
	});

	const groups: { id: ThemeGroup; label: string }[] = [
		{ id: 'classic', label: 'Classic' },
		{ id: 'style', label: 'Styles' },
		{ id: 'palette', label: 'Palettes' }
	];

	const current = $derived(THEMES.find((t) => t.id === theme));

	function choose(value: Theme) {
		theme = value;
		setTheme(value);
	}
</script>

<!-- A miniature of the app in the given theme: the wrapper carries its own data-theme, so every
     var(--…) inside resolves to that theme's tokens regardless of the one currently applied. -->
{#snippet preview(id: Theme)}
	<div
		data-theme={id}
		class="flex h-full min-w-0 flex-1 flex-col justify-center gap-1.5 bg-[var(--color-bg)] px-2 [background-image:var(--bg-pattern)] [background-size:var(--bg-pattern-size)]"
		style="font-family: var(--font-sans); text-shadow: var(--text-glow)"
	>
		<div
			class="flex items-center justify-between gap-1 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-1.5 py-1 shadow-[var(--shadow-soft)]"
		>
			<span
				class="text-sm leading-4 text-[var(--color-text)]"
				style="font-family: var(--font-heading); font-weight: var(--heading-weight); font-size-adjust: var(--heading-size-adjust)"
				>Aa</span
			>
			<span class="h-2.5 w-5 min-w-2 shrink rounded-[var(--radius-pill)] bg-[var(--color-accent)]"></span>
		</div>
		<div class="flex gap-1">
			<span class="h-1.5 w-7 rounded-full bg-[var(--color-text-muted)] opacity-60"></span>
			<span class="h-1.5 w-3 rounded-full bg-[var(--color-success)] opacity-80"></span>
		</div>
	</div>
{/snippet}

<Modal bind:open title="Settings">
	<div class="space-y-5">
		<div>
			<p class="section-label mb-2">Appearance</p>
			<div class="space-y-3">
				{#each groups as group (group.id)}
					<div>
						<p class="mb-1.5 text-xs text-[var(--color-text-muted)]">{group.label}</p>
						<div class="grid grid-cols-3 gap-2">
							{#each THEMES.filter((t) => t.group === group.id) as option (option.id)}
								{@const selected = theme === option.id}
								<button
									type="button"
									onclick={() => choose(option.id)}
									aria-pressed={selected}
									aria-label={`${option.label} theme`}
									class={`flex flex-col overflow-hidden rounded-[var(--radius-md)] border text-left transition-colors ${
										selected
											? 'border-[var(--color-accent)] ring-1 ring-[var(--color-accent)]'
											: 'border-[var(--color-border)] hover:border-[var(--color-text-muted)]'
									}`}
								>
									<div class="flex h-14 w-full" aria-hidden="true">
										{#if option.id === 'system'}
											{@render preview('light')}
											{@render preview('dark')}
										{:else}
											{@render preview(option.id)}
										{/if}
									</div>
									<span
										class={`flex items-center justify-between gap-1 border-t border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1.5 text-xs font-medium ${
											selected ? 'text-[var(--color-accent)]' : 'text-[var(--color-text)]'
										}`}
									>
										{option.label}
										{#if selected}<Icon name="check" size={14} />{/if}
									</span>
								</button>
							{/each}
						</div>
					</div>
				{/each}
			</div>
			<p class="mt-2 text-xs text-[var(--color-text-muted)]">
				{current?.blurb ?? ''}. Saved on this device.
			</p>
		</div>

		{#if isAdmin}
			<a
				href="/admin"
				onclick={() => (open = false)}
				class="flex items-center gap-2 border-t border-[var(--color-border)] pt-4 px-1 pb-1 text-sm font-medium text-[var(--color-text)] hover:text-[var(--color-accent)]"
			>
				<Icon name="sliders" size={18} />
				Admin panel
			</a>
		{/if}

		<form method="POST" action="/logout" class="border-t border-[var(--color-border)] pt-4">
			<button
				type="submit"
				class="flex w-full items-center gap-2 rounded-[var(--radius-md)] px-1 py-2 text-sm font-medium text-[var(--color-danger)] hover:bg-[var(--color-danger-soft)]"
			>
				<Icon name="logout" size={18} />
				Sign out
			</button>
		</form>
	</div>
</Modal>
