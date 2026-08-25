<script lang="ts">
	import Icon from './Icon.svelte';

	// Classic drag-to-reveal before/after comparison: both photos fill the same frame, the "after" photo
	// sits on top clipped to the right of a draggable handle, the "before" photo underneath shows through
	// on the left. Dragging the handle left reveals more of "after"; dragging right reveals more of
	// "before". Pure pointer events, no gesture library — same "no deps" approach as PhotoLightbox.
	let {
		beforeSrc,
		afterSrc,
		beforeLabel = null,
		afterLabel = null
	}: {
		beforeSrc: string;
		afterSrc: string;
		beforeLabel?: string | null;
		afterLabel?: string | null;
	} = $props();

	let containerEl: HTMLDivElement | undefined = $state();
	let pct = $state(50);
	let dragging = $state(false);

	// Reset to the midpoint whenever a new pair of photos is selected.
	$effect(() => {
		beforeSrc;
		afterSrc;
		pct = 50;
	});

	function pctFromClientX(clientX: number): number {
		if (!containerEl) return pct;
		const rect = containerEl.getBoundingClientRect();
		const x = Math.min(Math.max(clientX - rect.left, 0), rect.width);
		return rect.width > 0 ? (x / rect.width) * 100 : 50;
	}

	function onPointerDown(e: PointerEvent) {
		dragging = true;
		containerEl?.setPointerCapture(e.pointerId);
		pct = pctFromClientX(e.clientX);
	}
	function onPointerMove(e: PointerEvent) {
		if (!dragging) return;
		pct = pctFromClientX(e.clientX);
	}
	function onPointerUp(e: PointerEvent) {
		dragging = false;
		containerEl?.releasePointerCapture(e.pointerId);
	}

	function onHandleKeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowLeft') {
			pct = Math.max(0, pct - 3);
			e.preventDefault();
		} else if (e.key === 'ArrowRight') {
			pct = Math.min(100, pct + 3);
			e.preventDefault();
		} else if (e.key === 'Home') {
			pct = 0;
			e.preventDefault();
		} else if (e.key === 'End') {
			pct = 100;
			e.preventDefault();
		}
	}
</script>

<div
	bind:this={containerEl}
	class="relative aspect-[3/4] w-full select-none overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] touch-none"
	role="presentation"
	onpointerdown={onPointerDown}
	onpointermove={onPointerMove}
	onpointerup={onPointerUp}
	onpointercancel={onPointerUp}
>
	<img src={beforeSrc} alt={beforeLabel ?? 'Before'} class="absolute inset-0 h-full w-full object-cover" draggable="false" />

	<div class="absolute inset-0 overflow-hidden" style={`clip-path: inset(0 0 0 ${pct}%);`}>
		<img src={afterSrc} alt={afterLabel ?? 'After'} class="absolute inset-0 h-full w-full object-cover" draggable="false" />
	</div>

	{#if beforeLabel}
		<div class="pointer-events-none absolute left-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white">{beforeLabel}</div>
	{/if}
	{#if afterLabel}
		<div class="pointer-events-none absolute right-2 top-2 rounded-full bg-black/55 px-2.5 py-1 text-xs font-medium text-white">{afterLabel}</div>
	{/if}

	<div class="pointer-events-none absolute inset-y-0 w-0.5 bg-white/90" style={`left: ${pct}%;`}>
		<button
			type="button"
			role="slider"
			aria-label="Comparison slider"
			aria-valuenow={Math.round(pct)}
			aria-valuemin={0}
			aria-valuemax={100}
			class="pointer-events-auto absolute left-1/2 top-1/2 flex h-9 w-9 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full bg-white text-[var(--color-text)] shadow-[var(--shadow-soft)]"
			onkeydown={onHandleKeydown}
		>
			<Icon name="move-horizontal" size={18} />
		</button>
	</div>
</div>
