<script lang="ts">
	// Renders a coach message as plain text with its citations made clickable — PMID 12345678 → PubMed,
	// NCT01234567 → ClinicalTrials.gov, bare https URLs → the page. Tokenized into text/link segments and
	// rendered as normal Svelte text nodes (never {@html}), so model output can't inject markup.
	let { text }: { text: string } = $props();

	type Segment = { kind: 'text'; value: string } | { kind: 'link'; value: string; href: string };

	const PATTERN = /(https?:\/\/[^\s<>"')\]]+[^\s<>"')\].,;:!?])|\bPMID[:\s]*(\d{5,9})\b|\b(NCT\d{8})\b/g;

	const segments = $derived.by(() => {
		const out: Segment[] = [];
		let last = 0;
		for (const m of text.matchAll(PATTERN)) {
			const start = m.index ?? 0;
			if (start > last) out.push({ kind: 'text', value: text.slice(last, start) });
			if (m[1]) out.push({ kind: 'link', value: m[1], href: m[1] });
			else if (m[2]) out.push({ kind: 'link', value: m[0], href: `https://pubmed.ncbi.nlm.nih.gov/${m[2]}/` });
			else if (m[3]) out.push({ kind: 'link', value: m[3], href: `https://clinicaltrials.gov/study/${m[3]}` });
			last = start + m[0].length;
		}
		if (last < text.length) out.push({ kind: 'text', value: text.slice(last) });
		return out;
	});
</script>

{#each segments as seg, i (i)}{#if seg.kind === 'link'}<a
			href={seg.href}
			target="_blank"
			rel="noopener noreferrer"
			class="text-[var(--color-accent)] underline decoration-[var(--color-accent-soft)] underline-offset-2 break-all">{seg.value}</a
		>{:else}{seg.value}{/if}{/each}
