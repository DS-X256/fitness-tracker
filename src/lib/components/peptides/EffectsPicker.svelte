<script lang="ts">
	// Side-effect check-in: tap a tag to add it (mild), then set its strength. Posts as one JSON hidden
	// field (`effects`) so the server can tell "no effects" ([]) from "field not sent" (keep existing).
	import { EFFECT_TAGS, SEVERITY_LABELS, effectLabel, type DoseEffect, type EffectSeverity, type EffectTag } from '$lib/utils/peptides';

	let { value = $bindable<DoseEffect[]>([]), name = 'effects' }: { value?: DoseEffect[]; name?: string } = $props();

	const selected = $derived(new Map(value.map((e) => [e.tag, e.severity])));

	function toggle(tag: EffectTag) {
		value = selected.has(tag) ? value.filter((e) => e.tag !== tag) : [...value, { tag, severity: 1 }];
	}
	function setSeverity(tag: EffectTag, severity: EffectSeverity) {
		value = value.map((e) => (e.tag === tag ? { ...e, severity } : e));
	}
	function toneClass(tone: 'bad' | 'good' | 'neutral', on: boolean): string {
		if (!on) return 'bg-[var(--color-surface)] border-[var(--color-border)] text-[var(--color-text)]';
		if (tone === 'good') return 'bg-[var(--color-success-soft)] border-[var(--color-success)] text-[var(--color-success)]';
		if (tone === 'bad') return 'bg-[var(--color-danger-soft)] border-[var(--color-danger)] text-[var(--color-danger)]';
		return 'bg-[var(--color-accent-soft)] border-[var(--color-accent)] text-[var(--color-text)]';
	}
</script>

<div>
	<div class="flex flex-wrap gap-1.5">
		{#each EFFECT_TAGS as t (t.value)}
			<button
				type="button"
				onclick={() => toggle(t.value)}
				aria-pressed={selected.has(t.value)}
				class={`h-8 px-3 rounded-full text-xs font-medium border transition-colors ${toneClass(t.tone, selected.has(t.value))}`}
			>
				{t.label}
			</button>
		{/each}
	</div>
	{#if value.length > 0}
		<div class="mt-2.5 space-y-1.5">
			{#each value as e (e.tag)}
				<div class="flex items-center justify-between gap-2">
					<span class="text-sm text-[var(--color-text)]">{effectLabel(e.tag)}</span>
					<div class="flex gap-1" role="group" aria-label={`${effectLabel(e.tag)} strength`}>
						{#each [1, 2, 3] as const as sev (sev)}
							<button
								type="button"
								onclick={() => setSeverity(e.tag, sev)}
								aria-pressed={e.severity === sev}
								class={`h-7 px-2.5 rounded-full text-xs border ${e.severity === sev ? 'border-[var(--color-accent)] bg-[var(--color-accent-soft)] text-[var(--color-text)] font-medium' : 'border-[var(--color-border)] text-[var(--color-text-muted)]'}`}
							>
								{SEVERITY_LABELS[sev]}
							</button>
						{/each}
					</div>
				</div>
			{/each}
		</div>
	{/if}
	<input type="hidden" {name} value={JSON.stringify(value)} />
</div>
