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

	// Magnet targets: each dose peak (a local maximum — between doses the curve only decays) plus the
	// newest sample. Near one, the scrubber locks onto it; elsewhere it follows the finger freely.
	const peakSet = $derived.by(() => {
		const out = new Set<number>();
		for (let i = 1; i < points.length; i++) {
			const v = points[i].mcg;
			if (v > 0 && v > points[i - 1].mcg && (i === points.length - 1 || v >= points[i + 1].mcg)) out.add(i);
		}
		return out;
	});
	const snapTargets = $derived.by(() => {
		const out = [...peakSet];
		if (points.length > 0 && out[out.length - 1] !== points.length - 1) out.push(points.length - 1);
		return out;
	});
	/** Screen-px reach of a magnet; shrunk where targets crowd so the gaps between stay draggable. */
	const SNAP_PX = 14;

	let scrubEl: HTMLButtonElement | undefined = $state();
	let dragId: number | null = null;
	let lastSnap: number | null = null;

	function pickAt(clientX: number) {
		if (!scrubEl || points.length === 0) return;
		const rect = scrubEl.getBoundingClientRect();
		if (rect.width <= 0) return;
		const plotLeft = rect.left + (padding.left / width) * rect.width;
		const plotW = (innerW / width) * rect.width;
		const span = toMs - fromMs || 1;
		const pxOf = (i: number) => ((points[i].t - fromMs) / span) * plotW;
		const x = Math.min(plotW, Math.max(0, clientX - plotLeft));

		let best = 0;
		for (let i = 1; i < points.length; i++) {
			if (Math.abs(pxOf(i) - x) < Math.abs(pxOf(best) - x)) best = i;
		}

		let snap: number | null = null;
		let snapDist = Infinity;
		for (let k = 0; k < snapTargets.length; k++) {
			const px = pxOf(snapTargets[k]);
			const prev = k > 0 ? pxOf(snapTargets[k - 1]) : -Infinity;
			const next = k < snapTargets.length - 1 ? pxOf(snapTargets[k + 1]) : Infinity;
			const reach = Math.min(SNAP_PX, 0.4 * (px - prev), 0.4 * (next - px));
			const d = Math.abs(px - x);
			if (d <= reach && d < snapDist) {
				snap = snapTargets[k];
				snapDist = d;
			}
		}

		// A tiny tick on landing on a new magnet, where the device supports it (not iOS Safari).
		if (snap != null && snap !== lastSnap && dragId != null) {
			try {
				navigator.vibrate?.(6);
			} catch {
				/* unsupported */
			}
		}
		lastSnap = snap;
		selected = snap ?? best;
	}

	function release() {
		selected = null;
		lastSnap = null;
	}

	function onPointerDown(e: PointerEvent) {
		if (e.pointerType === 'mouse' && e.button !== 0) return;
		dragId = e.pointerId;
		// Keep receiving moves when the finger strays off the chart, so the drag isn't dropped mid-scrub.
		scrubEl?.setPointerCapture(e.pointerId);
		pickAt(e.clientX);
	}
	function onPointerMove(e: PointerEvent) {
		// Mouse scrubs on hover too; touch/pen only while pressed.
		if (e.pointerId === dragId || (dragId == null && e.pointerType === 'mouse')) pickAt(e.clientX);
	}
	function onPointerEnd(e: PointerEvent) {
		if (e.pointerId !== dragId) return;
		dragId = null;
		if (e.pointerType !== 'mouse') release();
	}

	// touch-action: pan-y leaves vertical page scrolling to the browser, but iOS can still grab a drag
	// that drifts vertically mid-scrub. Decide the gesture's direction once from its first movement and,
	// if it's horizontal, own the whole touch so the page can't take it over.
	function lockHorizontalDrag(node: HTMLElement) {
		let startX = 0;
		let startY = 0;
		let mode: 'undecided' | 'scrub' | 'scroll' = 'undecided';
		const onStart = (e: TouchEvent) => {
			startX = e.touches[0].clientX;
			startY = e.touches[0].clientY;
			mode = 'undecided';
		};
		const onMove = (e: TouchEvent) => {
			if (e.touches.length !== 1) return;
			if (mode === 'undecided') {
				const dx = Math.abs(e.touches[0].clientX - startX);
				const dy = Math.abs(e.touches[0].clientY - startY);
				if (dx < 3 && dy < 3) return;
				mode = dx >= dy ? 'scrub' : 'scroll';
			}
			if (mode === 'scrub' && e.cancelable) e.preventDefault();
		};
		node.addEventListener('touchstart', onStart, { passive: true });
		node.addEventListener('touchmove', onMove, { passive: false });
		return () => {
			node.removeEventListener('touchstart', onStart);
			node.removeEventListener('touchmove', onMove);
		};
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
	<!-- select-none + no touch callout: a long press on the chart must not start an iOS text selection. -->
	<div class="relative w-full select-none [-webkit-touch-callout:none]">
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
					r={peakSet.has(active) ? 4.5 : 3.5}
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
				<p class="text-[0.6875rem] text-[var(--color-text-muted)] tabular-nums">
					{fmtInstant(activePoint.t)}{#if peakSet.has(active)}<span class="ml-1 font-medium text-[var(--color-accent)]">· peak</span>{/if}
				</p>
			</div>
		{/if}

		<!-- Transparent scrub target over the whole chart: pointer to drag a readout (snapping to dose peaks),
		     arrow keys to step. -->
		<button
			bind:this={scrubEl}
			{@attach lockHorizontalDrag}
			type="button"
			aria-label="Scrub the estimated level curve"
			class="absolute inset-0 cursor-col-resize touch-pan-y [-webkit-tap-highlight-color:transparent]"
			onpointerdown={onPointerDown}
			onpointermove={onPointerMove}
			onpointerup={onPointerEnd}
			onpointercancel={onPointerEnd}
			onpointerleave={() => {
				if (dragId == null) release();
			}}
			oncontextmenu={(e) => e.preventDefault()}
			onkeydown={onKey}
		></button>
	</div>
{/if}
