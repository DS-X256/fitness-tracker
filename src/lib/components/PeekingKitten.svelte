<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import { backOut } from 'svelte/easing';
	import { onKittenPeek } from '$lib/utils/kitten';

	// Blossom-theme reward: after the user logs something, the pink kitten peeks up from the bottom
	// edge, a blue baby kitten scoots in beside her and they hug. Whether it shows (theme, cooldown,
	// chance) is decided by celebrate() in $lib/utils/kitten — this component only plays it.
	const VISIBLE_MS = 5_500;

	let visible = $state(false);
	let side = $state<'left' | 'right'>('right');

	const reduceMotion =
		typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

	// Both kittens share one drawing (in a 120×100 box); only the colours and the bow differ.
	const pink = { fur: '#ffc6dd', ear: '#ffb3d1', inner: '#ff7fb4', line: '#e8609b', blush: '#ff7fb4' };
	const blue = { fur: '#c6e2ff', ear: '#b3d6ff', inner: '#7fb6ff', line: '#5f97e0', blush: '#ff9fc6' };

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
		aria-label="Hide kittens"
		onclick={() => (visible = false)}
		class={`fixed bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 w-52 ${side === 'left' ? 'left-2 -scale-x-100' : 'right-2'}`}
		transition:fly={{ y: reduceMotion ? 0 : 90, duration: reduceMotion ? 150 : 550, easing: backOut }}
	>
		<svg viewBox="0 0 230 110" class="hug w-full overflow-visible drop-shadow-[0_4px_10px_rgba(255,79,154,0.35)]" aria-hidden="true">
			{#snippet kitten(c: typeof pink, bow: boolean)}
				<!-- ears -->
				<path d="M24 44 L30 8 L52 30 Z" fill={c.ear} stroke={c.line} stroke-width="2.5" stroke-linejoin="round" />
				<path d="M96 44 L90 8 L68 30 Z" fill={c.ear} stroke={c.line} stroke-width="2.5" stroke-linejoin="round" />
				<path d="M31 36 L33 18 L44 30 Z" fill={c.inner} />
				<path d="M89 36 L87 18 L76 30 Z" fill={c.inner} />
				<!-- head -->
				<ellipse cx="60" cy="56" rx="40" ry="34" fill={c.fur} stroke={c.line} stroke-width="2.5" />
				{#if bow}
					<g transform="translate(82 22) rotate(18)">
						<path d="M0 0 L-12 -8 L-12 8 Z M0 0 L12 -8 L12 8 Z" fill="#ff4f9a" stroke="#d6307c" stroke-width="1.5" stroke-linejoin="round" />
						<circle r="3.5" fill="#ff8fc0" stroke="#d6307c" stroke-width="1.5" />
					</g>
				{:else}
					<!-- baby tuft -->
					<path d="M56 23 Q60 12 66 20 Q62 18 60 24" fill={c.fur} stroke={c.line} stroke-width="2" stroke-linejoin="round" />
				{/if}
				<!-- happy closed eyes while hugging -->
				<path d="M38 55 Q44 48 50 55 M70 55 Q76 48 82 55" fill="none" stroke="#5a1a3a" stroke-width="3" stroke-linecap="round" />
				<!-- blush -->
				<ellipse cx="34" cy="66" rx="7" ry="4" fill={c.blush} opacity="0.55" />
				<ellipse cx="86" cy="66" rx="7" ry="4" fill={c.blush} opacity="0.55" />
				<!-- nose + mouth -->
				<path d="M57 62 L63 62 L60 66 Z" fill="#ff4f9a" />
				<path d="M60 66 Q56 71 52 68 M60 66 Q64 71 68 68" fill="none" stroke="#5a1a3a" stroke-width="2" stroke-linecap="round" />
				<!-- whiskers -->
				<path d="M20 60 L34 63 M20 68 L34 67 M100 60 L86 63 M100 68 L86 67" stroke={c.line} stroke-width="1.5" stroke-linecap="round" />
				<!-- paws on the edge -->
				<ellipse cx="38" cy="92" rx="12" ry="8" fill={c.fur} stroke={c.line} stroke-width="2.5" />
				<ellipse cx="82" cy="92" rx="12" ry="8" fill={c.fur} stroke={c.line} stroke-width="2.5" />
			{/snippet}
			<!-- blue baby: scoots in from the outer side, then leans in -->
			<g transform="translate(104 8)">
				<g class="blue">
					<g class="lean-blue">{@render kitten(blue, false)}</g>
				</g>
			</g>
			<!-- pink: already peeking, leans towards the baby -->
			<g transform="translate(6 8)">
				<g class="lean-pink">{@render kitten(pink, true)}</g>
			</g>
			<!-- the hug: each wraps a paw around the other -->
			<g class="arms">
				<path d="M160 90 Q128 74 104 84" fill="none" stroke="#5f97e0" stroke-width="15" stroke-linecap="round" />
				<path d="M160 90 Q128 74 104 84" fill="none" stroke="#c6e2ff" stroke-width="10" stroke-linecap="round" />
				<path d="M72 96 Q100 88 124 96" fill="none" stroke="#e8609b" stroke-width="15" stroke-linecap="round" />
				<path d="M72 96 Q100 88 124 96" fill="none" stroke="#ffc6dd" stroke-width="10" stroke-linecap="round" />
			</g>
			<!-- a heart pops up between them -->
			<path
				class="heart"
				d="M115 12c-2.4-4-9.6-2.9-9.6 2.4 0 4 5.6 6.7 9.6 10.9 4-4.2 9.6-6.9 9.6-10.9 0-5.3-7.2-6.4-9.6-2.4z"
				fill="#ff4f9a"
			/>
		</svg>
	</button>
{/if}

<style>
	/* Final (hugging) state is the base style; the animations play in from the start state, so
	   reduced motion simply shows the hug. */
	.blue,
	.lean-pink,
	.lean-blue,
	.heart {
		transform-box: fill-box;
	}
	.blue {
		animation: scoot-in 0.6s cubic-bezier(0.34, 1.56, 0.64, 1) 0.45s backwards;
	}
	.lean-pink {
		transform-origin: 50% 100%;
		transform: rotate(7deg);
		animation: lean-pink 0.45s ease-out 1.05s backwards;
	}
	.lean-blue {
		transform-origin: 50% 100%;
		transform: translateX(-8px) rotate(-8deg);
		animation: lean-blue 0.45s ease-out 1.05s backwards;
	}
	.arms {
		animation: arms 0.35s ease-out 1.25s backwards;
	}
	.heart {
		transform-origin: 50% 100%;
		animation:
			pop 0.4s cubic-bezier(0.34, 1.56, 0.64, 1) 1.45s backwards,
			float 2s ease-in-out 1.85s infinite;
	}
	@keyframes scoot-in {
		from { transform: translateX(150px); opacity: 0; }
	}
	@keyframes lean-pink {
		from { transform: rotate(0deg); }
	}
	@keyframes lean-blue {
		from { transform: translateX(0) rotate(0deg); }
	}
	@keyframes arms {
		from { opacity: 0; }
	}
	@keyframes pop {
		from { transform: scale(0); opacity: 0; }
	}
	@keyframes float {
		0%, 100% { transform: translateY(0); }
		50% { transform: translateY(-5px); }
	}
	@media (prefers-reduced-motion: reduce) {
		.blue, .lean-pink, .lean-blue, .arms, .heart { animation: none; }
	}
</style>
