<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { onKittenPeek } from '$lib/utils/kitten';

	// Blossom-theme reward: a pink kitten peeks up from the bottom edge for a few seconds after
	// the user logs something. Whether it shows (theme, cooldown, chance) is decided by celebrate()
	// in $lib/utils/kitten — this component only plays it.
	const VISIBLE_MS = 4_500;

	let visible = $state(false);
	let side = $state<'left' | 'right'>('right');

	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	onMount(() => {
		let hideTimer: ReturnType<typeof setTimeout>;
		const stop = onKittenPeek(() => {
			// Let a closing modal get out of the way first.
			setTimeout(() => {
				side = Math.random() < 0.5 ? 'left' : 'right';
				visible = true;
				clearTimeout(hideTimer);
				hideTimer = setTimeout(() => (visible = false), VISIBLE_MS);
			}, 350);
		});
		return () => {
			stop();
			clearTimeout(hideTimer);
		};
	});
</script>

{#if visible}
	<button
		type="button"
		aria-label="Hide kitten"
		onclick={() => (visible = false)}
		class={`fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 w-24 ${side === 'left' ? 'left-3 -scale-x-100' : 'right-3'}`}
		transition:fly={{ y: reduceMotion ? 0 : 90, duration: reduceMotion ? 150 : 550, easing: backOut }}
	>
		<svg viewBox="0 0 120 100" class="kitten w-full drop-shadow-[0_4px_10px_rgba(255,79,154,0.35)]" aria-hidden="true">
			<!-- ears -->
			<path d="M24 44 L30 8 L52 30 Z" fill="#ffb3d1" stroke="#e8609b" stroke-width="2.5" stroke-linejoin="round" />
			<path d="M96 44 L90 8 L68 30 Z" fill="#ffb3d1" stroke="#e8609b" stroke-width="2.5" stroke-linejoin="round" />
			<path d="M31 36 L33 18 L44 30 Z" fill="#ff7fb4" />
			<path d="M89 36 L87 18 L76 30 Z" fill="#ff7fb4" />
			<!-- head -->
			<ellipse cx="60" cy="56" rx="40" ry="34" fill="#ffc6dd" stroke="#e8609b" stroke-width="2.5" />
			<!-- bow -->
			<g transform="translate(82 22) rotate(18)">
				<path d="M0 0 L-12 -8 L-12 8 Z M0 0 L12 -8 L12 8 Z" fill="#ff4f9a" stroke="#d6307c" stroke-width="1.5" stroke-linejoin="round" />
				<circle r="3.5" fill="#ff8fc0" stroke="#d6307c" stroke-width="1.5" />
			</g>
			<!-- eyes -->
			<g class="eyes">
				<ellipse cx="44" cy="54" rx="5.5" ry="7" fill="#5a1a3a" />
				<ellipse cx="76" cy="54" rx="5.5" ry="7" fill="#5a1a3a" />
				<circle cx="46" cy="51" r="2" fill="#fff" />
				<circle cx="78" cy="51" r="2" fill="#fff" />
			</g>
			<!-- blush -->
			<ellipse cx="34" cy="68" rx="7" ry="4" fill="#ff7fb4" opacity="0.55" />
			<ellipse cx="86" cy="68" rx="7" ry="4" fill="#ff7fb4" opacity="0.55" />
			<!-- nose + mouth -->
			<path d="M57 63 L63 63 L60 67 Z" fill="#ff4f9a" />
			<path d="M60 67 Q56 72 52 69 M60 67 Q64 72 68 69" fill="none" stroke="#5a1a3a" stroke-width="2" stroke-linecap="round" />
			<!-- whiskers -->
			<path d="M20 60 L34 63 M20 68 L34 67 M100 60 L86 63 M100 68 L86 67" stroke="#e8609b" stroke-width="1.5" stroke-linecap="round" />
			<!-- paws on the edge -->
			<ellipse cx="38" cy="92" rx="12" ry="8" fill="#ffc6dd" stroke="#e8609b" stroke-width="2.5" />
			<ellipse cx="82" cy="92" rx="12" ry="8" fill="#ffc6dd" stroke="#e8609b" stroke-width="2.5" />
			<!-- a little heart -->
			<path class="heart" d="M108 30c-1.5-2.5-6-1.8-6 1.5 0 2.5 3.5 4.2 6 6.8 2.5-2.6 6-4.3 6-6.8 0-3.3-4.5-4-6-1.5z" fill="#ff4f9a" />
		</svg>
	</button>
{/if}

<style>
	.kitten .eyes {
		transform-origin: 60px 54px;
		animation: blink 3.2s infinite;
	}
	.kitten .heart {
		transform-origin: 108px 34px;
		animation: float 2.2s ease-in-out infinite;
	}
	@keyframes blink {
		0%, 44%, 50%, 100% { transform: scaleY(1); }
		47% { transform: scaleY(0.1); }
	}
	@keyframes float {
		0%, 100% { transform: translateY(0); opacity: 0.9; }
		50% { transform: translateY(-5px); opacity: 1; }
	}
	@media (prefers-reduced-motion: reduce) {
		.kitten .eyes, .kitten .heart { animation: none; }
	}
</style>
