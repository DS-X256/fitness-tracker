<script lang="ts">
	// A tiny trend line of an estimated level (see activeAmountMcg/levelSeries in $lib/utils/peptides) for a
	// list row — the glanceable version of LevelChart, same accent line + faint area, no axes. The full
	// chart (with axes, hover and ranges) is one tap away on the compound page / levels screen, so this
	// only carries the shape and a "now" marker; its accessible label states the current estimate.
	import { formatLevel, levelSeries } from '$lib/utils/peptides';

	let {
		doses,
		halfLifeHours,
		nowMs,
		days = 14,
		label
	}: {
		doses: { date: string; doseMcg: number }[];
		halfLifeHours: number;
		nowMs: number;
		days?: number;
		/** What the line shows, for screen readers (e.g. "Retatrutide"). */
		label: string;
	} = $props();

	const W = 96;
	const H = 28;
	const PAD = 3; // keeps the 2px line and the end dot inside the box

	const points = $derived(levelSeries(doses, halfLifeHours, nowMs - days * 86_400_000, nowMs, 72));
	const peak = $derived(points.reduce((m, p) => Math.max(m, p.mcg), 0));
	const coords = $derived(
		points.map((p, i) => ({
			x: PAD + (i / Math.max(1, points.length - 1)) * (W - PAD * 2),
			y: H - PAD - (peak > 0 ? (p.mcg / peak) * (H - PAD * 2) : 0)
		}))
	);
	const line = $derived(coords.map((c, i) => `${i ? 'L' : 'M'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' '));
	const area = $derived(coords.length ? `${line} L${coords.at(-1)!.x.toFixed(1)},${H - PAD} L${coords[0].x.toFixed(1)},${H - PAD} Z` : '');
	const end = $derived(coords.at(-1) ?? null);
	const now = $derived(points.at(-1)?.mcg ?? 0);
</script>

{#if coords.length > 1 && peak > 0}
	<svg
		viewBox={`0 0 ${W} ${H}`}
		width={W}
		height={H}
		class="shrink-0 overflow-visible"
		role="img"
		aria-label={`${label}: estimated level over the last ${days} days, now about ${formatLevel(now)}`}
	>
		<path d={area} class="fill-[var(--color-accent)]" fill-opacity="0.12" />
		<path d={line} fill="none" class="stroke-[var(--color-accent)]" stroke-width="1.5" stroke-linejoin="round" stroke-linecap="round" />
		{#if end}
			<circle cx={end.x} cy={end.y} r="3" class="fill-[var(--color-accent)] stroke-[var(--color-surface)]" stroke-width="2" />
		{/if}
	</svg>
{/if}
