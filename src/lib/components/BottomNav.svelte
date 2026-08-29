<script lang="ts">
	import { page } from '$app/state';
	import Icon from './Icon.svelte';

	const items = [
		{ href: '/', label: 'Home', icon: 'home' as const },
		{ href: '/meals', label: 'Meals', icon: 'meals' as const },
		{ href: '/shopping-list', label: 'Shopping', icon: 'cart' as const },
		{ href: '/workouts', label: 'Workouts', icon: 'dumbbell' as const },
		// Health groups the Body suite + Peptides behind one slot (see HealthNav for the sub-tabs).
		{ href: '/body', label: 'Health', icon: 'health' as const, match: ['/body', '/peptides'] },
		{ href: '/assistant', label: 'Coach', icon: 'sparkles' as const }
	];

	function isActive(item: { href: string; match?: string[] }) {
		if (item.href === '/') return page.url.pathname === '/';
		return (item.match ?? [item.href]).some((p) => page.url.pathname.startsWith(p));
	}
</script>

<nav
	class="sticky bottom-0 z-30 flex bg-[var(--color-surface)]/95 backdrop-blur-sm border-t border-[var(--color-border)] pb-[env(safe-area-inset-bottom)]"
>
	{#each items as item (item.href)}
		{@const active = isActive(item)}
		<a
			href={item.href}
			class={`flex-1 flex flex-col items-center gap-0.5 py-2.5 text-xs font-medium transition-colors ${
				active ? 'text-[var(--color-accent)]' : 'text-[var(--color-text-muted)]'
			}`}
		>
			<Icon name={item.icon} size={22} />
			{item.label}
		</a>
	{/each}
</nav>
