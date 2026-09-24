<script lang="ts">
	// "4 mg KLOW → GHK-Cu 2.5 mg · BPC-157 500 mcg · …" — how a blend dose splits into its components.
	import { formatDose } from '$lib/utils/peptides';

	let {
		portions,
		estimated = false,
		linkable = false,
		class: className = ''
	}: {
		portions: { peptideId?: number | null; name: string; mcg: number }[];
		/** Split reconstructed from the blend's current ratio (dose logged before splits were recorded). */
		estimated?: boolean;
		/** Link each component to its compound page. */
		linkable?: boolean;
		class?: string;
	} = $props();
</script>

{#if portions.length > 0}
	<p class={`text-xs text-[var(--color-text-muted)] tabular-nums leading-relaxed ${className}`}>
		{#if estimated}<span title="Split estimated from the blend's current ratio">{'≈ '}</span>{/if}{#each portions as p, i (i)}{#if i > 0}<span aria-hidden="true">{' · '}</span>{/if}<span class="whitespace-nowrap"
				>{#if linkable && p.peptideId != null}<a href={`/peptides/${p.peptideId}`} class="hover:text-[var(--color-accent)]">{p.name}</a
					>{:else}{p.name}{/if}{' '}<span class="text-[var(--color-text)]">{formatDose(p.mcg)}</span></span
			>{/each}
	</p>
{/if}
