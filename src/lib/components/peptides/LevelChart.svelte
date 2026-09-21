<script lang="ts">
	// Estimated medication level over time, as a filled area with one vertical step per dose. Hand-rolled
	// inline SVG to match the app's no-charting-library convention (see workouts/ProgressChart).
	//
	// The unit (mcg vs mg) is picked once from the window's peak rather than per value, so the axis and
	// the readout can't disagree mid-chart the way formatDose's per-value switch would.

	import type { LevelPoint } from '$lib/utils/peptides';

	let {
		points,
		fromMs,
		toMs
	}: { points: LevelPoint[]; fromMs: number; toMs: number } = $props();

	const width = 340;
	const height = 180;
	const padding = { top: 18, right: 38, bottom: 20, left: 6 };
	const innerW = width - padding.left - padding.right;
	const innerH = height - padding.top - padding.bottom;
	const baseline = padding.top + innerH;

	/** Round a peak up to a readable axis maximum (1, 1.5, 2, 2.5 … × 10ⁿ). */
	function niceCeil(v: number): number {
		if (!Number.isFinite(v) || v <= 0) return 1;
		const base = 10 ** Math.floor(Math.log10(v));
		for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 7.5]) {
			if (v <= m * base) return m * base;
		}
		return 10 * base;
	}

	const peak = $derived(points.reduce((m, p) => (p.mcg > m ? p.mcg : m), 0));
	const yMax = $derived(niceCeil(peak));
	const inMg = $derived(yMax >= 1000);

	function fmtValue(mcg: number, maxFractionDigits = 2): string {
		const v = inMg ? mcg / 1000 : mcg;
		return v.toLocaleString(undefined, { maximumFractionDigits: inMg ? maxFractionDigits : 0 });
	}
	const unitLabel = $derived(inMg ? 'mg' : 'mcg');

	function xOf(t: number): number {
		const span = toMs - fromMs || 1;
		return padding.left + ((t - fromMs) / span) * innerW;
	}
	function yOf(mcg: number): number {
		return padding.top + innerH - (Math.min(mcg, yMax) / (yMax || 1)) * innerH;
	}

	const coords = $derived(points.map((p) => ({ x: xOf(p.t), y: yOf(p.mcg) })));
	const linePath = $derived(
		coords.length === 0 ? '' : coords.map((c, i) => `${i === 0 ? 'M' : 'L'}${c.x.toFixed(1)},${c.y.toFixed(1)}`).join(' ')
	);
	const areaPath = $derived(
		coords.length === 0
			? ''
			: `${linePath} L${coords[coords.length - 1].x.toFixed(1)},${baseline} L${coords[0].x.toFixed(1)},${baseline} Z`
	);

	const gridLines = $derived(
		[0, 0.25, 0.5, 0.75, 1].map((f) => ({ y: padding.top + innerH - f * innerH, value: f * yMax }))
	);

	const xTicks = $derived(
		[0, 0.33, 0.66, 1].map((f) => {
			const t = fromMs + f * (toMs - fromMs);
			return {
				x: padding.left + f * innerW,
				anchor: f === 0 ? 'start' : f === 1 ? 'end' : 'middle',
				label: new Date(t).toLocaleDateString(undefined, { day: 'numeric', month: 'numeric' })
			};
		})
	);

	// --- Scrubber -------------------------------------------------------------------------------------
	// null = nothing picked, which reads out the newest sample (the current level).
	let selected = $state<number | null>(null);
	const active = $derived(
		selected != null && selected >= 0 && selected < points.length ? selected : points.length - 1
	);
	const activePoint = $derived(points.length > 0 ? points[active] : null);

	function selectAtFraction(frac: number) {
		if (points.length === 0) return;
		const f = Math.min(1, Math.max(0, frac));
		const t = fromMs + f * (toMs - fromMs);
		let best = 0;
		for (let i = 1; i < points.length; i++) {
			if (Math.abs(points[i].t - t) < Math.abs(points[best].t - t)) best = i;
		}
		selected = best;
	}

	function onMove(e: PointerEvent) {
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		if (rect.width > 0) selectAtFraction((e.clientX - rect.left) / rect.width);
	}

	function onKey(e: KeyboardEvent) {
		if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
		e.preventDefault();
		const next = active + (e.key === 'ArrowRight' ? 1 : -1);
		selected = Math.min(points.length - 1, Math.max(0, next));
	}

	function fmtInstant(t: number): string {
		return new Date(t).toLocaleString(undefined, {
			day: 'numeric',
			month: 'short',
			year: 'numeric',
			hour: '2-digit',
			minute: '2-digit'
		});
	}
</script>

{#if points.length === 0}
	<p class="py-8 text-center text-sm text-[var(--color-text-muted)]">Nothing to chart for this range.</p>
{:else}
	<div class="relative w-full">
		<svg
			viewBox={`0 0 ${width} ${height}`}
			class="w-full h-auto"
			preserveAspectRatio="xMidYMid meet"
			role="img"
			aria-label={`Estimated level over time, peaking at ${fmtValue(peak)} ${unitLabel}`}
		>
			<defs>
				<linearGradient id="level-fill" x1="0" y1="0" x2="0" y2="1">
					<stop offset="0%" class="[stop-color:var(--color-accent)]" stop-opacity="0.45" />
					<stop offset="100%" class="[stop-color:var(--color-accent)]" stop-opacity="0.06" />
				</linearGradient>
			</defs>

			{#each gridLines as g (g.y)}
				<line
					x1={padding.left}
					y1={g.y}
					x2={padding.left + innerW}
					y2={g.y}
					class="stroke-[var(--color-border)]"
					stroke-width="1"
					stroke-dasharray={g.value === 0 ? '0' : '2 3'}
				/>
				<text
					x={padding.left + innerW + 5}
					y={g.y + 3}
					font-size="9"
					class="fill-[var(--color-text-muted)]"
					vector-effect="non-scaling-stroke">{fmtValue(g.value, 1)}{unitLabel}</text
				>
			{/each}

			<path d={areaPath} fill="url(#level-fill)" />
			<path
				d={linePath}
				fill="none"
				class="stroke-[var(--color-accent)]"
				stroke-width="1.75"
				stroke-linejoin="round"
				stroke-linecap="round"
			/>

			{#if activePoint}
				{@const cx = xOf(activePoint.t)}
				<line
					x1={cx}
					y1={padding.top}
					x2={cx}
					y2={baseline}
					class="stroke-[var(--color-accent)]"
					stroke-width="1"
					stroke-opacity="0.6"
				/>
				<circle
					cx={cx}
					cy={yOf(activePoint.mcg)}
					r="3.5"
					class="fill-[var(--color-bg)] stroke-[var(--color-accent)]"
					stroke-width="2"
				/>
			{/if}

			{#each xTicks as tick (tick.x)}
				<text
					x={tick.x}
					y={height - 6}
					text-anchor={tick.anchor}
					font-size="9"
					class="fill-[var(--color-text-muted)]">{tick.label}</text
				>
			{/each}
		</svg>

		{#if activePoint}
			<div class="pointer-events-none absolute left-0 top-0 leading-tight">
				<p class="text-base font-semibold text-[var(--color-text)] tabular-nums">
					{fmtValue(activePoint.mcg)}<span class="text-xs font-normal text-[var(--color-text-muted)]">{unitLabel}</span>
				</p>
				<p class="text-[0.6875rem] text-[var(--color-text-muted)] tabular-nums">{fmtInstant(activePoint.t)}</p>
			</div>
		{/if}

		<!-- Transparent scrub target over the plot area: pointer to drag a readout, arrow keys to step. -->
		<button
			type="button"
			aria-label="Scrub the estimated level curve"
			class="absolute cursor-col-resize"
			style={`left:${(padding.left / width) * 100}%;right:${(padding.right / width) * 100}%;top:${(padding.top / height) * 100}%;bottom:${(padding.bottom / height) * 100}%`}
			onpointerdown={onMove}
			onpointermove={onMove}
			onpointerleave={() => (selected = null)}
			onkeydown={onKey}
		></button>
	</div>
{/if}
