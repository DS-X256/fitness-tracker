<script lang="ts">
	import { untrack } from 'svelte';
	import { fade } from 'svelte/transition';
	import { browser } from '$app/environment';
	import Icon from './Icon.svelte';

	export type LightboxPhoto = { id: number; date: string; label?: string | null; caption?: string | null };

	let {
		open = $bindable(false),
		photos,
		startId = null,
		srcBase,
		onclose
	}: {
		open?: boolean;
		photos: LightboxPhoto[];
		startId?: number | null;
		srcBase: string;
		onclose?: () => void;
	} = $props();

	// Respect reduced-motion by collapsing the enter/exit animation to instant — same convention as Modal.
	const reduceMotion = browser && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const scrimDur = reduceMotion ? 0 : 160;

	let stripEl: HTMLDivElement | undefined = $state();
	let closeBtn: HTMLButtonElement | undefined = $state();
	let activeIndex = $state(0);
	const active = $derived(photos[activeIndex]);

	// Seeks to `startId` only on the open transition — reads startId/photos untracked so later changes to
	// either (e.g. the parent's photo list changing while this stays open) don't re-trigger the jump.
	$effect(() => {
		if (!open) return;
		const targetId = untrack(() => startId);
		const list = untrack(() => photos);
		activeIndex = Math.max(0, list.findIndex((p) => p.id === targetId));
		requestAnimationFrame(() => {
			if (stripEl) stripEl.scrollLeft = activeIndex * stripEl.clientWidth; // instant — no smooth-scroll on open
			closeBtn?.focus();
		});
	});

	// Locks background scroll while open; self-tears-down on close AND on unmount (e.g. back-button nav).
	$effect(() => {
		if (!open) return;
		const prev = document.documentElement.style.overflow;
		document.documentElement.style.overflow = 'hidden';
		return () => {
			document.documentElement.style.overflow = prev;
		};
	});

	function onScroll() {
		if (!stripEl) return;
		activeIndex = Math.round(stripEl.scrollLeft / stripEl.clientWidth);
	}

	function goTo(i: number) {
		if (!stripEl || i < 0 || i >= photos.length) return;
		stripEl.scrollTo({ left: i * stripEl.clientWidth, behavior: 'smooth' });
	}

	function close() {
		open = false;
		onclose?.();
	}

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Escape') close();
		else if (e.key === 'ArrowRight') goTo(activeIndex + 1);
		else if (e.key === 'ArrowLeft') goTo(activeIndex - 1);
	}

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
	}
</script>

<svelte:window onkeydown={open ? onKeydown : undefined} />

{#if open}
	<div
		class="fixed inset-0 z-[60] bg-black flex flex-col"
		role="dialog"
		aria-modal="true"
		aria-label="Photo viewer"
		transition:fade={{ duration: scrimDur }}
	>
		<div
			class="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-gradient-to-b from-black/70 to-transparent px-3 pt-[calc(0.75rem+env(safe-area-inset-top))] pb-6"
		>
			<div class="min-w-0">
				<p class="text-sm font-medium text-white tabular-nums">{active ? fmtDate(active.date) : ''}</p>
				{#if active?.label || active?.caption}
					<p class="truncate text-xs text-white/75">
						{active.label ?? ''}{active.label && active.caption ? ' · ' : ''}{active.caption ?? ''}
					</p>
				{/if}
			</div>
			<div class="flex items-center gap-2 shrink-0">
				{#if photos.length > 1}
					<span class="text-xs text-white/60 tabular-nums">{activeIndex + 1} / {photos.length}</span>
				{/if}
				<button
					bind:this={closeBtn}
					type="button"
					aria-label="Close"
					class="h-9 w-9 flex items-center justify-center rounded-full text-white hover:bg-white/10"
					onclick={close}
				>
					<Icon name="x" size={20} />
				</button>
			</div>
		</div>

		<div
			bind:this={stripEl}
			onscroll={onScroll}
			class="flex-1 flex overflow-x-auto snap-x snap-mandatory"
			style="overscroll-behavior-x: contain; touch-action: pan-x;"
		>
			{#each photos as photo, i (photo.id)}
				<div class="w-full h-full shrink-0 snap-center flex items-center justify-center">
					<img
						src={`${srcBase}/${photo.id}/file`}
						alt={`Progress photo ${fmtDate(photo.date)}`}
						class="max-h-full max-w-full object-contain"
						loading={Math.abs(i - activeIndex) <= 1 ? 'eager' : 'lazy'}
						decoding="async"
					/>
				</div>
			{/each}
		</div>
	</div>
{/if}
