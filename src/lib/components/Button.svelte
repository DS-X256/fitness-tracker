<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'primary',
		size = 'md',
		type = 'button',
		href,
		disabled = false,
		full = false,
		onclick,
		children,
		class: className = ''
	}: {
		variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
		size?: 'md' | 'lg' | 'icon';
		type?: 'button' | 'submit' | 'reset';
		href?: string;
		disabled?: boolean;
		full?: boolean;
		onclick?: (e: MouseEvent) => void;
		children: Snippet;
		class?: string;
	} = $props();

	const base =
		'inline-flex items-center justify-center gap-1.5 font-medium transition duration-150 active:scale-[0.98] disabled:opacity-50 disabled:pointer-events-none select-none';

	const variants: Record<string, string> = {
		primary:
			'bg-[var(--color-accent)] text-[var(--color-on-accent)] hover:bg-[var(--color-accent-hover)] active:bg-[var(--color-accent-hover)]',
		secondary:
			'bg-[var(--color-surface-alt)] text-[var(--color-text)] hover:brightness-95 active:brightness-90',
		ghost: 'bg-transparent text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]',
		danger: 'bg-[var(--color-danger-soft)] text-[var(--color-danger)] hover:brightness-95'
	};

	const sizes: Record<string, string> = {
		md: 'h-11 px-4 text-[15px] rounded-[var(--radius-md)]',
		lg: 'h-13 px-5 text-base rounded-[var(--radius-md)]',
		icon: 'h-11 w-11 shrink-0 rounded-[var(--radius-pill)]'
	};

	const classes = $derived(`${base} ${variants[variant]} ${sizes[size]} ${full ? 'w-full' : ''} ${className}`);
</script>

{#if href && !disabled}
	<a {href} class={classes}>
		{@render children()}
	</a>
{:else}
	<button {type} {disabled} {onclick} class={classes}>
		{@render children()}
	</button>
{/if}
