<script lang="ts">
	import { sitesForRoute, type AdminRoute, type ApplicationSite } from '$lib/utils/peptides';

	// Route-driven: renders whichever site set belongs to `route` (injection body sites, nasal nostrils,
	// topical areas, ...) and renders nothing for routes with no site concept (oral, sublingual). This is
	// the single picker component for every route rather than an injection-only one, so a route change in
	// the parent form is all it takes to swap the grid.
	let {
		value = $bindable<ApplicationSite | null>(null),
		name = 'site',
		route,
		suggested = null
	}: {
		value?: ApplicationSite | null;
		name?: string;
		route: AdminRoute | '';
		suggested?: ApplicationSite | null;
	} = $props();

	const sites = $derived(sitesForRoute(route));

	function pick(site: ApplicationSite) {
		value = value === site ? null : site;
	}
</script>

{#if sites.length > 0}
	<input type="hidden" {name} value={value ?? ''} />
	<div class={`grid ${sites.length > 3 ? 'grid-cols-2' : 'grid-cols-3'} gap-1.5`}>
		{#each sites as site (site.value)}
			{@const selected = value === site.value}
			<button
				type="button"
				onclick={() => pick(site.value)}
				aria-pressed={selected}
				class={`relative flex items-center justify-between gap-1 h-10 px-3 rounded-[var(--radius-md)] border text-sm transition-colors ${
					selected
						? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)] font-medium'
						: 'border-[var(--color-border)] bg-[var(--color-surface)] text-[var(--color-text-muted)]'
				}`}
			>
				<span>{site.label}</span>
				{#if suggested === site.value && !selected}
					<span class="text-[10px] uppercase tracking-wide text-[var(--color-accent)] font-semibold">next</span>
				{/if}
			</button>
		{/each}
	</div>
{/if}
