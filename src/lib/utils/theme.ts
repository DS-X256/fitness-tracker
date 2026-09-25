/** 'system' is Auto: the classic light/dark pair following the OS. Every other id is a
 *  [data-theme='…'] token set in src/routes/layout.css. Keep THEME_IDS in sync with the
 *  inline script in app.html, which applies the saved theme before first paint. */
export const THEME_IDS = [
	'system',
	'light',
	'dark',
	'modern',
	'retro',
	'terminal',
	'blossom',
	'midnight',
	'forest',
	'ocean',
	'rose',
	'mono'
] as const;

export type Theme = (typeof THEME_IDS)[number];

export type ThemeGroup = 'classic' | 'style' | 'palette';

export const THEMES: { id: Theme; label: string; group: ThemeGroup; blurb: string }[] = [
	{ id: 'system', label: 'Auto', group: 'classic', blurb: 'Light or dark, following your device' },
	{ id: 'light', label: 'Light', group: 'classic', blurb: 'Warm beige with terracotta' },
	{ id: 'dark', label: 'Dark', group: 'classic', blurb: 'Warm charcoal with terracotta' },
	{ id: 'modern', label: 'Modern', group: 'style', blurb: 'Ops-console graphite, sharp and gridded' },
	{ id: 'retro', label: 'Retro', group: 'style', blurb: 'Cream paper, ink lines, typewriter type' },
	{ id: 'terminal', label: 'Terminal', group: 'style', blurb: 'Green-phosphor CRT' },
	{ id: 'blossom', label: 'Blossom', group: 'style', blurb: 'Candy pink, hearts and bubbly type' },
	{ id: 'midnight', label: 'Midnight', group: 'palette', blurb: 'Deep navy with violet' },
	{ id: 'forest', label: 'Forest', group: 'palette', blurb: 'Sage and moss green' },
	{ id: 'ocean', label: 'Ocean', group: 'palette', blurb: 'Cool slate and blue' },
	{ id: 'rose', label: 'Rosé', group: 'palette', blurb: 'Blush with raspberry' },
	{ id: 'mono', label: 'Mono', group: 'palette', blurb: 'Black and white' }
];

const STORAGE_KEY = 'theme';

function isTheme(value: unknown): value is Theme {
	return typeof value === 'string' && (THEME_IDS as readonly string[]).includes(value);
}

/** Reads the saved preference. Defaults to 'system' (follow the OS). */
export function getTheme(): Theme {
	if (typeof localStorage === 'undefined') return 'system';
	const value = localStorage.getItem(STORAGE_KEY);
	return isTheme(value) ? value : 'system';
}

/** Applies a theme to <html>: sets data-theme for a manual choice, removes it for 'system'
 *  so the prefers-color-scheme media query takes over. Mirrors the inline script in app.html. */
export function applyTheme(theme: Theme) {
	if (typeof document === 'undefined') return;
	const root = document.documentElement;
	if (theme === 'system') {
		delete root.dataset.theme;
	} else {
		root.dataset.theme = theme;
	}
	syncThemeColor(theme);
}

// app.html ships one theme-color per OS scheme; remember them so Auto can restore them.
const defaultThemeColors = new Map<HTMLMetaElement, string>();

/** Points the browser/PWA chrome colour (<meta name="theme-color">) at the active theme's
 *  background. With a picked theme both OS-scheme variants get the same colour; Auto restores
 *  app.html's originals. */
export function syncThemeColor(theme: Theme = getTheme()) {
	if (typeof document === 'undefined') return;
	const metas = document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]');
	for (const meta of metas) {
		if (!defaultThemeColors.has(meta)) defaultThemeColors.set(meta, meta.content);
	}
	const bg =
		theme === 'system'
			? ''
			: getComputedStyle(document.documentElement).getPropertyValue('--color-bg').trim();
	for (const meta of metas) {
		meta.content = bg || defaultThemeColors.get(meta) || meta.content;
	}
}

/** Persists and applies the chosen theme. */
export function setTheme(theme: Theme) {
	if (typeof localStorage !== 'undefined') {
		if (theme === 'system') localStorage.removeItem(STORAGE_KEY);
		else localStorage.setItem(STORAGE_KEY, theme);
	}
	applyTheme(theme);
}
