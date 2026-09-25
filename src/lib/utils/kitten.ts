/** Blossom-theme reward: call after the user logs something (a set, a dose, food…). Now and
 *  then — never within COOLDOWN_MS of the last peek, and only on some logs — it asks
 *  PeekingKitten to pop up, so it feels like a little cheer rather than a pop-up on every tap. */
const EVENT = 'kitten:peek';
const COOLDOWN_MS = 90_000;
const CHANCE = 0.45;

let lastPeek = 0;

export function celebrate() {
	if (typeof document === 'undefined') return;
	if (document.documentElement.dataset.theme !== 'blossom') return;
	const now = Date.now();
	if (now - lastPeek < COOLDOWN_MS || Math.random() > CHANCE) return;
	lastPeek = now;
	window.dispatchEvent(new CustomEvent(EVENT));
}

export function onKittenPeek(handler: () => void) {
	window.addEventListener(EVENT, handler);
	return () => window.removeEventListener(EVENT, handler);
}
