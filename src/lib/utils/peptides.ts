// Shared, dependency-free peptide domain constants + formatting. Pure — safe on client and server.
// Dose is stored canonically in micrograms (mcg) everywhere; conversion to mg is display-only.

export type PeptideCategory = 'glp1' | 'healing' | 'gh_secretagogue' | 'other';

export const PEPTIDE_CATEGORIES: { value: PeptideCategory; label: string }[] = [
	{ value: 'glp1', label: 'GLP-1 agonist' },
	{ value: 'healing', label: 'Healing / recovery' },
	{ value: 'gh_secretagogue', label: 'GH secretagogue' },
	{ value: 'other', label: 'Other' }
];

export function categoryLabel(c: PeptideCategory | null | undefined): string {
	return PEPTIDE_CATEGORIES.find((x) => x.value === c)?.label ?? 'Uncategorized';
}

export function isPeptideCategory(v: unknown): v is PeptideCategory {
	return typeof v === 'string' && PEPTIDE_CATEGORIES.some((x) => x.value === v);
}

/** --- Administration routes ------------------------------------------------------------------------
 *  InjectionRoute is the original, narrower type — kept as a subtype of AdminRoute rather than folded
 *  away, because isInjectionRoute() stays the gate that decides whether the syringe-units readout and
 *  the (injection-site-shaped) SitePicker apply. Everything non-injection is a NonInjectionRoute. */
export type InjectionRoute = 'subq' | 'im';
export type NonInjectionRoute = 'intranasal' | 'topical' | 'oral' | 'sublingual' | 'transdermal';
export type AdminRoute = InjectionRoute | NonInjectionRoute;

export const ROUTE_LABELS: Record<AdminRoute, string> = {
	subq: 'Subcutaneous',
	im: 'Intramuscular',
	intranasal: 'Intranasal',
	topical: 'Topical',
	oral: 'Oral',
	sublingual: 'Sublingual',
	transdermal: 'Transdermal'
};

export const ADMIN_ROUTES: { value: AdminRoute; label: string }[] = (Object.keys(ROUTE_LABELS) as AdminRoute[]).map(
	(value) => ({ value, label: ROUTE_LABELS[value] })
);

/** Narrower than isAdminRoute — this is the semantic gate for "needle + syringe units apply here", not
 *  just a membership check. UI branches on this, not on the string value, to decide what to show. */
export function isInjectionRoute(v: unknown): v is InjectionRoute {
	return v === 'subq' || v === 'im';
}

export function isAdminRoute(v: unknown): v is AdminRoute {
	return typeof v === 'string' && Object.prototype.hasOwnProperty.call(ROUTE_LABELS, v);
}

/** --- Application sites -----------------------------------------------------------------------------
 *  ApplicationSite is partitioned per route: injection keeps its original 10 body sites, nasal gets
 *  nostril rotation, topical gets skin/joint areas, oral and sublingual have no site at all (null).
 *  InjectionSite is kept as the original type (a subtype of ApplicationSite) for the same reason
 *  InjectionRoute was: isInjectionSite() is a meaningful narrower gate, not just historical baggage. */
export type InjectionSite =
	| 'abdomen_l'
	| 'abdomen_r'
	| 'love_handle_l'
	| 'love_handle_r'
	| 'thigh_l'
	| 'thigh_r'
	| 'delt_l'
	| 'delt_r'
	| 'glute_l'
	| 'glute_r';

export const INJECTION_SITES: { value: InjectionSite; label: string; region: string }[] = [
	{ value: 'delt_l', label: 'Left delt', region: 'Delt' },
	{ value: 'delt_r', label: 'Right delt', region: 'Delt' },
	{ value: 'abdomen_l', label: 'Left abdomen', region: 'Abdomen' },
	{ value: 'abdomen_r', label: 'Right abdomen', region: 'Abdomen' },
	{ value: 'love_handle_l', label: 'Left love handle', region: 'Love handle' },
	{ value: 'love_handle_r', label: 'Right love handle', region: 'Love handle' },
	{ value: 'thigh_l', label: 'Left thigh', region: 'Thigh' },
	{ value: 'thigh_r', label: 'Right thigh', region: 'Thigh' },
	{ value: 'glute_l', label: 'Left glute', region: 'Glute' },
	{ value: 'glute_r', label: 'Right glute', region: 'Glute' }
];

export type NasalSite = 'nostril_l' | 'nostril_r' | 'nostril_both';

export const NASAL_SITES: { value: NasalSite; label: string; region: string }[] = [
	{ value: 'nostril_l', label: 'Left nostril', region: 'Nostril' },
	{ value: 'nostril_r', label: 'Right nostril', region: 'Nostril' },
	{ value: 'nostril_both', label: 'Both nostrils', region: 'Nostril' }
];

export type TopicalSite = 'face' | 'neck' | 'scalp' | 'hands' | 'joint_l' | 'joint_r';

export const TOPICAL_SITES: { value: TopicalSite; label: string; region: string }[] = [
	{ value: 'face', label: 'Face', region: 'Face' },
	{ value: 'neck', label: 'Neck', region: 'Neck' },
	{ value: 'scalp', label: 'Scalp', region: 'Scalp' },
	{ value: 'hands', label: 'Hands', region: 'Hands' },
	{ value: 'joint_l', label: 'Left joint', region: 'Joint' },
	{ value: 'joint_r', label: 'Right joint', region: 'Joint' }
];

/** Patch placement, for rotation the same way injection sites and nostrils rotate. Values are prefixed
 *  distinctly from InjectionSite/TopicalSite on purpose — "abdomen" is a plausible patch spot too, but a
 *  shared literal would blur which route family a logged site actually belongs to. */
export type TransdermalSite = 'shoulder_l' | 'shoulder_r' | 'upper_back_l' | 'upper_back_r' | 'flank_l' | 'flank_r';

export const TRANSDERMAL_SITES: { value: TransdermalSite; label: string; region: string }[] = [
	{ value: 'shoulder_l', label: 'Left shoulder', region: 'Shoulder' },
	{ value: 'shoulder_r', label: 'Right shoulder', region: 'Shoulder' },
	{ value: 'upper_back_l', label: 'Left upper back', region: 'Upper back' },
	{ value: 'upper_back_r', label: 'Right upper back', region: 'Upper back' },
	{ value: 'flank_l', label: 'Left flank', region: 'Flank' },
	{ value: 'flank_r', label: 'Right flank', region: 'Flank' }
];

export type ApplicationSite = InjectionSite | NasalSite | TopicalSite | TransdermalSite;

const ALL_SITES: { value: ApplicationSite; label: string; region: string }[] = [
	...INJECTION_SITES,
	...NASAL_SITES,
	...TOPICAL_SITES,
	...TRANSDERMAL_SITES
];

/** The site options for a route's picker. Empty for routes with no site concept (oral, sublingual). */
export function sitesForRoute(route: AdminRoute | ''): { value: ApplicationSite; label: string; region: string }[] {
	if (route === 'subq' || route === 'im') return INJECTION_SITES;
	if (route === 'intranasal') return NASAL_SITES;
	if (route === 'topical') return TOPICAL_SITES;
	if (route === 'transdermal') return TRANSDERMAL_SITES;
	return [];
}

export function siteLabel(s: ApplicationSite | null | undefined): string {
	return ALL_SITES.find((x) => x.value === s)?.label ?? '—';
}

export function isInjectionSite(v: unknown): v is InjectionSite {
	return typeof v === 'string' && INJECTION_SITES.some((x) => x.value === v);
}

export function isApplicationSite(v: unknown): v is ApplicationSite {
	return typeof v === 'string' && ALL_SITES.some((x) => x.value === v);
}

/** Given the sites used most recently for `route` (index 0 = most recent), suggest the least-recently-used
 *  site within that route's own set to rotate to. Null for routes with no site concept. The algorithm is
 *  unchanged from the original injection-only version, just parameterized by candidate set — an
 *  injection-route call with an injection-only history produces byte-identical suggestions to before. */
export function suggestNextSite(route: AdminRoute | '', recentMostRecentFirst: (ApplicationSite | null)[]): ApplicationSite | null {
	const candidates = sitesForRoute(route);
	if (candidates.length === 0) return null;
	const used = recentMostRecentFirst.filter((s): s is ApplicationSite => s != null && candidates.some((c) => c.value === s));
	const unused = candidates.find((s) => !used.includes(s.value));
	if (unused) return unused.value;
	// All sites used — pick the one used longest ago (appears latest in the recency list, or not at all).
	let best = candidates[0].value;
	let bestRank = -1;
	for (const { value } of candidates) {
		const rank = used.indexOf(value); // smaller = more recent
		if (rank > bestRank) {
			bestRank = rank;
			best = value;
		}
	}
	return best;
}

/** --- Containers --------------------------------------------------------------------------------------
 *  What a peptide is physically held in. 'vial' is the original (and only) shape — lyophilized powder
 *  reconstituted with BAC water, drawn on a syringe. The rest are additive. */
export type ContainerForm = 'vial' | 'nasal_spray' | 'serum' | 'capsules' | 'patches';

export const CONTAINER_FORM_LABELS: Record<ContainerForm, string> = {
	vial: 'Reconstituted vial',
	nasal_spray: 'Nasal spray',
	serum: 'Topical serum',
	capsules: 'Capsules',
	patches: 'Patches'
};

export function isContainerForm(v: unknown): v is ContainerForm {
	return typeof v === 'string' && Object.prototype.hasOwnProperty.call(CONTAINER_FORM_LABELS, v);
}

/** The route a container's form implies, for prefilling the log-dose form the moment a container is
 *  picked. 'vial' is deliberately excluded — it's ambiguous between subq and im, so the user still picks. */
export function defaultRouteForContainerForm(form: ContainerForm | null | undefined): AdminRoute | '' {
	switch (form) {
		case 'nasal_spray':
			return 'intranasal';
		case 'serum':
			return 'topical';
		case 'capsules':
			return 'oral';
		case 'patches':
			return 'transdermal';
		default:
			return '';
	}
}

/** The inverse of defaultRouteForContainerForm — which container form a route is normally paired with,
 *  used to pick the best-matching container automatically (e.g. for one-tap quick-log). */
export function containerFormForRoute(route: AdminRoute | null | undefined): ContainerForm | null {
	switch (route) {
		case 'subq':
		case 'im':
			return 'vial';
		case 'intranasal':
			return 'nasal_spray';
		case 'topical':
			return 'serum';
		case 'oral':
			return 'capsules';
		case 'transdermal':
			return 'patches';
		default:
			return null;
	}
}

/** The container a new dose of `peptideId` by `route` should come from: not depleted, not expired, of the
 *  form the route implies, preferring the most recently used one (the one already open), then the oldest.
 *  `lastUsed` is a sortable "date|createdAt" key per container. Null when nothing fits — never an
 *  expired or wrong-form container. Shared by one-tap logging (server) and the log form (client). */
export function pickContainer<
	V extends { id: number; peptideId: number; form: ContainerForm; depleted?: boolean; expiresAt?: string | null; lastUsed?: string | null }
>(vials: V[], peptideId: number, route: AdminRoute | '' | null | undefined, today: string): V | null {
	const wantForm = containerFormForRoute(route || null);
	const candidates = vials.filter(
		(v) => v.peptideId === peptideId && !v.depleted && !(v.expiresAt && v.expiresAt < today) && (wantForm == null || v.form === wantForm)
	);
	if (candidates.length === 0) return null;
	return [...candidates].sort((a, b) => {
		const la = a.lastUsed ?? '';
		const lb = b.lastUsed ?? '';
		if (la !== lb) return la < lb ? 1 : -1;
		return a.id - b.id;
	})[0];
}

/** --- Dose recording -----------------------------------------------------------------------------------
 *  What the user actually measured out, alongside the canonical mcg figure. 'unit' is syringe units
 *  (U-100), preserved from before this type existed. */
export type MeasureUnit = 'unit' | 'ml' | 'spray' | 'drop' | 'pump' | 'capsule' | 'patch';

export const MEASURE_UNIT_LABELS: Record<MeasureUnit, string> = {
	unit: 'units',
	ml: 'mL',
	spray: 'sprays',
	drop: 'drops',
	pump: 'pumps',
	capsule: 'capsules',
	patch: 'patches'
};

export function isMeasureUnit(v: unknown): v is MeasureUnit {
	return typeof v === 'string' && Object.prototype.hasOwnProperty.call(MEASURE_UNIT_LABELS, v);
}

/** The measure unit a container's form is normally logged in — used for "N left" alert copy. */
export function measureUnitForContainerForm(form: ContainerForm): MeasureUnit {
	switch (form) {
		case 'nasal_spray':
			return 'spray';
		case 'serum':
			return 'drop';
		case 'capsules':
			return 'capsule';
		case 'patches':
			return 'patch';
		default:
			return 'unit';
	}
}

/** 'prime' marks an actuation spent clearing a new nasal-spray/pump container, not an actual dose.
 *  'remove' marks taking a transdermal patch off — also not a dose. Both are excluded from adherence
 *  (see repositories/peptideDoses.ts). They differ in inventory terms: a prime still drew product from
 *  the container, so it counts toward consumption; a removal doesn't consume anything beyond what
 *  applying the patch already recorded, so it's excluded from consumption too (see mcgConsumedByVial).
 *  'skip' is a deliberate "not taking this one" marker against a scheduled slot: it consumes nothing and
 *  isn't a dose, but adherence counts it as skipped rather than missed (see $lib/utils/peptideAdherence). */
export type DoseKind = 'dose' | 'prime' | 'remove' | 'skip';

export function isDoseKind(v: unknown): v is DoseKind {
	return v === 'dose' || v === 'prime' || v === 'remove' || v === 'skip';
}

/** --- Side-effect check-ins -----------------------------------------------------------------------------
 *  Quick, structured "how did it go" tags attached to a logged dose — a fixed list (not free text) so
 *  they can be counted and compared across doses, with a 1-3 severity. Free-form detail still goes in the
 *  dose's notes. `tone` only drives chip colouring; it isn't a judgement the app makes about the effect. */
export type EffectTag =
	| 'nausea'
	| 'site_reaction'
	| 'headache'
	| 'fatigue'
	| 'poor_sleep'
	| 'better_sleep'
	| 'energy_up'
	| 'appetite_down'
	| 'water_retention'
	| 'tingling'
	| 'flushing'
	| 'gi_upset'
	| 'other';

export const EFFECT_TAGS: { value: EffectTag; label: string; tone: 'bad' | 'good' | 'neutral' }[] = [
	{ value: 'nausea', label: 'Nausea', tone: 'bad' },
	{ value: 'site_reaction', label: 'Site reaction', tone: 'bad' },
	{ value: 'headache', label: 'Headache', tone: 'bad' },
	{ value: 'fatigue', label: 'Fatigue', tone: 'bad' },
	{ value: 'poor_sleep', label: 'Poor sleep', tone: 'bad' },
	{ value: 'better_sleep', label: 'Better sleep', tone: 'good' },
	{ value: 'energy_up', label: 'More energy', tone: 'good' },
	{ value: 'appetite_down', label: 'Less appetite', tone: 'neutral' },
	{ value: 'water_retention', label: 'Water retention', tone: 'bad' },
	{ value: 'tingling', label: 'Tingling / numbness', tone: 'bad' },
	{ value: 'flushing', label: 'Flushing', tone: 'neutral' },
	{ value: 'gi_upset', label: 'GI upset', tone: 'bad' },
	{ value: 'other', label: 'Other', tone: 'neutral' }
];

export type EffectSeverity = 1 | 2 | 3;
export type DoseEffect = { tag: EffectTag; severity: EffectSeverity };

export const SEVERITY_LABELS: Record<EffectSeverity, string> = { 1: 'Mild', 2: 'Moderate', 3: 'Strong' };

export function isEffectTag(v: unknown): v is EffectTag {
	return typeof v === 'string' && EFFECT_TAGS.some((t) => t.value === v);
}

export function effectLabel(tag: EffectTag): string {
	return EFFECT_TAGS.find((t) => t.value === tag)?.label ?? tag;
}

/** Keeps only known tags with a 1-3 severity, one entry per tag (last one wins). Tolerant of junk input
 *  (anything unparseable is dropped rather than failing the whole dose write). */
export function sanitizeEffects(input: unknown): DoseEffect[] {
	if (!Array.isArray(input)) return [];
	const byTag = new Map<EffectTag, EffectSeverity>();
	for (const raw of input) {
		if (!raw || typeof raw !== 'object') continue;
		const tag = (raw as { tag?: unknown }).tag;
		const sev = Number((raw as { severity?: unknown }).severity);
		if (!isEffectTag(tag)) continue;
		byTag.set(tag, (sev === 1 || sev === 2 || sev === 3 ? sev : 1) as EffectSeverity);
	}
	return [...byTag].map(([tag, severity]) => ({ tag, severity }));
}

/** Display a canonical mcg dose as mcg under 1000, otherwise mg. */
export function formatDose(mcg: number | null | undefined): string {
	if (mcg == null || !Number.isFinite(mcg)) return '—';
	if (mcg < 1000) return `${round(mcg, 0)} mcg`;
	return `${round(mcg / 1000, 3)} mg`;
}

export function mgToMcg(mg: number): number {
	return mg * 1000;
}
export function mcgToMg(mcg: number): number {
	return mcg / 1000;
}

function round(n: number, dp: number): number {
	const f = 10 ** dp;
	return Math.round(n * f) / f;
}

/** --- Blends ------------------------------------------------------------------------------------------
 *  A blend is a peptide compound that's really several compounds combined into one container (e.g. a
 *  "KLOW" vial). Each component carries its share of the blend's total mg — either as an absolute label
 *  amount (`labelMg`, what the vial's label says: "GHK-Cu 50 mg, BPC-157 10 mg, …") or as a `percent` —
 *  and blendShares() below turns whichever was entered into normalized fractions, so the same recipe
 *  scales to whatever size vial the user actually bought. `peptideId` links a component to its own
 *  compound row, which is what lets a logged "4 mg KLOW" show up as GHK-Cu/BPC-157/… intake everywhere
 *  (history, levels, the AI). Presets are commonly-sold compositions, not a dosing recommendation; every
 *  field stays editable, matching this app's "no dosing guidance" stance elsewhere. */
export type BlendComponent = {
	name: string;
	/** Share of the blend's total mg, 0-100. Always stored (derived from labelMg when that was entered). */
	percent: number;
	/** The compound row this component is tracked as. Null only for rows saved before linking existed. */
	peptideId?: number | null;
	/** mg of this component per vial as printed on the label, when entered that way (else null). */
	labelMg?: number | null;
};

/** One component's share of one logged dose — the "4 mg KLOW = 2.5 mg GHK-Cu + …" split. */
export type BlendPortion = { peptideId: number | null; name: string; mcg: number };

export const MAX_BLEND_COMPONENTS = 8;

export type BlendPreset = {
	name: string;
	category: PeptideCategory;
	/** The usual total vial size, mg — also becomes the compound's reference vialMg. */
	vialMg: number;
	components: { name: string; labelMg: number }[];
};

/** Starter recipes offered when the user marks a compound as a blend — one tap prefills name + label
 *  amounts, which they can then edit before saving. Compositions are the ones these blends are most
 *  commonly sold as (e.g. KLOW 80 mg = GHK-Cu 50 + BPC-157 10 + TB-500 10 + KPV 10); vendors vary, so the
 *  UI says so and keeps every row editable. Not auto-seeded like PRESET_PEPTIDES. */
export const BLEND_PRESETS: BlendPreset[] = [
	{
		name: 'KLOW',
		category: 'healing',
		vialMg: 80,
		components: [
			{ name: 'GHK-Cu', labelMg: 50 },
			{ name: 'BPC-157', labelMg: 10 },
			{ name: 'TB-500', labelMg: 10 },
			{ name: 'KPV', labelMg: 10 }
		]
	},
	{
		name: 'GLOW',
		category: 'healing',
		vialMg: 70,
		components: [
			{ name: 'GHK-Cu', labelMg: 50 },
			{ name: 'BPC-157', labelMg: 10 },
			{ name: 'TB-500', labelMg: 10 }
		]
	},
	{
		name: 'BPC-157 / TB-500',
		category: 'healing',
		vialMg: 10,
		components: [
			{ name: 'BPC-157', labelMg: 5 },
			{ name: 'TB-500', labelMg: 5 }
		]
	},
	{
		name: 'CJC-1295 / Ipamorelin',
		category: 'gh_secretagogue',
		vialMg: 10,
		components: [
			{ name: 'CJC-1295', labelMg: 5 },
			{ name: 'Ipamorelin', labelMg: 5 }
		]
	},
	{
		name: 'Semaglutide / Cagrilintide',
		category: 'glp1',
		vialMg: 10,
		components: [
			{ name: 'Semaglutide', labelMg: 5 },
			{ name: 'Cagrilintide', labelMg: 5 }
		]
	}
];

/** A preset as editable component rows (percent derived from the label amounts). */
export function presetComponents(preset: BlendPreset): BlendComponent[] {
	const total = preset.components.reduce((sum, c) => sum + c.labelMg, 0);
	return preset.components.map((c) => ({
		name: c.name,
		labelMg: c.labelMg,
		percent: total > 0 ? round((c.labelMg / total) * 100, 2) : 0,
		peptideId: null
	}));
}

/** Case/spacing/punctuation-insensitive key for matching a component name to a compound row, so
 *  "BPC 157", "bpc-157" and "BPC157" all find the same compound. */
export function normalizeCompoundName(name: string): string {
	return name.toLowerCase().replace(/[\s\-_.]+/g, '');
}

/** True when every component has a positive label amount — the blend was entered as label mg. */
export function usesLabelMg(components: BlendComponent[]): boolean {
	return components.length > 0 && components.every((c) => c.labelMg != null && Number.isFinite(c.labelMg) && c.labelMg > 0);
}

/** Each component's fraction of the blend (summing to exactly 1), from label mg when every row has one,
 *  otherwise from percent. Normalizing by the actual sum means a ratio that rounds to 99.99% still splits
 *  a dose completely rather than silently losing a sliver of it. All zeros when nothing usable is set. */
export function blendShares(components: BlendComponent[]): number[] {
	const weights = usesLabelMg(components)
		? components.map((c) => c.labelMg as number)
		: components.map((c) => (Number.isFinite(c.percent) && c.percent > 0 ? c.percent : 0));
	const total = weights.reduce((a, b) => a + b, 0);
	return total > 0 ? weights.map((w) => w / total) : weights.map(() => 0);
}

/** The core blend feature: a logged dose of the whole blend, split into each component's micrograms.
 *  Works in whole nanograms with largest-remainder rounding, so the parts always add back up to exactly
 *  the logged dose — 4000 mcg of KLOW is 2500 + 500 + 500 + 500, never 2499.999 + … */
export function splitBlendDose(doseMcg: number, components: BlendComponent[]): BlendPortion[] {
	const shares = blendShares(components);
	const totalNg = Math.round(Math.max(0, doseMcg) * 1000);
	const raw = shares.map((sh) => sh * totalNg);
	const floors = raw.map(Math.floor);
	let remainder = totalNg - floors.reduce((a, b) => a + b, 0);
	const order = raw.map((r, i) => ({ i, frac: r - Math.floor(r) })).sort((a, b) => b.frac - a.frac);
	for (const { i } of order) {
		if (remainder <= 0) break;
		if (shares[i] <= 0) continue;
		floors[i]++;
		remainder--;
	}
	return components.map((c, i) => ({ peptideId: c.peptideId ?? null, name: c.name, mcg: floors[i] / 1000 }));
}

/** Sum of a component list's percentages, rounded for display/validation (float-safe). */
export function blendPercentTotal(components: BlendComponent[]): number {
	return round(components.reduce((sum, c) => sum + (Number.isFinite(c.percent) ? c.percent : 0), 0), 2);
}

/** True when a blend's components add up close enough to 100% to accept (small float slack). A blend
 *  entered as label mg is always valid — its percentages are derived, not typed. */
export function isValidBlendTotal(components: BlendComponent[]): boolean {
	if (usesLabelMg(components)) return true;
	const total = blendPercentTotal(components);
	return total >= 99.5 && total <= 100.5;
}

/** Given a blend's ratio and the actual total mg of a specific vial, estimate how many mg of each
 *  component that vial contains. Null mg (rather than 0) when the total isn't known yet, so callers can
 *  render "—" instead of a misleading zero. */
export function suggestBlendComponentMg(
	totalMg: number | null | undefined,
	components: BlendComponent[]
): { name: string; mg: number | null }[] {
	const shares = blendShares(components);
	return components.map((c, i) => ({
		name: c.name,
		mg: totalMg != null && Number.isFinite(totalMg) ? round(totalMg * shares[i], 2) : null
	}));
}

/** Compact "GHK-Cu 50 mg · KPV 10 mg · …" (or "GHK-Cu 62.5% · …") label for list rows. */
export function blendRatioSummary(components: BlendComponent[]): string {
	if (usesLabelMg(components)) return components.map((c) => `${c.name} ${round(c.labelMg as number, 2)} mg`).join(' · ');
	const shares = blendShares(components);
	return components.map((c, i) => `${c.name} ${round(shares[i] * 100, 1)}%`).join(' · ');
}

/** "GHK-Cu 2.5 mg · BPC-157 500 mcg · …" for a split dose. */
export function blendPortionSummary(portions: BlendPortion[]): string {
	return portions.map((p) => `${p.name} ${formatDose(p.mcg)}`).join(' · ');
}

/** --- Active-in-body estimate ---------------------------------------------------------------------
 *  A rough single-compartment elimination model — exponential decay from each logged dose, summed —
 *  for long-acting peptides where "how much is still circulating" is meaningful. Weekly GLP-1 dosing
 *  (Retatrutide, Semaglutide, Tirzepatide, Cagrilintide) is the main case: a dose from 4 days ago is
 *  still mostly present. Not a real PK model (no absorption/distribution phase, one terminal half-life
 *  only) and not dosing guidance — a ballpark for someone tracking their own regimen, same spirit as
 *  the rest of this file. halfLifeHours lives on the peptide record itself (reference-only,
 *  user-editable, same pattern as vialMg); STANDARD_HALF_LIVES_HOURS below just prefills it. */

/** Published/label terminal half-lives, in hours, for compounds whose PK is actually characterized.
 *  Approximate by nature (they vary with dose, route and person) — they only ever PREFILL a field the
 *  user can overwrite. Order matters: suggestHalfLifeHours takes the first key CONTAINED in the name, so
 *  a more specific variant must precede the bare name it contains ('cjc-1295 dac' before 'cjc-1295').
 *  Deliberately absent: BPC-157, TB-500, GHK-Cu, KPV and friends — no dependable human PK to quote, so
 *  those compounds get no suggestion and the field stays the user's own to fill in. */
export const STANDARD_HALF_LIVES_HOURS: Record<string, number> = {
	'cjc-1295 dac': 168, // with DAC: ~6-8 days
	'cjc-1295': 0.5, // without DAC (mod-GRF 1-29): ~30 min
	semaglutide: 168, // ~7 days
	cagrilintide: 168, // ~7 days
	retatrutide: 144, // ~6 days
	survodutide: 150, // ~6 days
	tirzepatide: 120, // ~5 days
	dulaglutide: 113, // ~4.7 days
	liraglutide: 13,
	bremelanotide: 2.7,
	'pt-141': 2.7, // bremelanotide under its common name
	exenatide: 2.4,
	ipamorelin: 2,
	tesamorelin: 0.6,
	sermorelin: 0.2
};

/** Case-insensitive, substring match against STANDARD_HALF_LIVES_HOURS — tolerant of a compound name
 *  that isn't an exact key (e.g. "Retatrutide 10mg/mL"). Null when nothing matches. */
export function suggestHalfLifeHours(name: string): number | null {
	const n = name.trim().toLowerCase();
	if (!n) return null;
	for (const [key, hours] of Object.entries(STANDARD_HALF_LIVES_HOURS)) {
		if (n.includes(key)) return hours;
	}
	return null;
}

/** When a dose logged on `date` is treated as having been administered. A dose row carries no reliable
 *  time of day, so everything anchors to local noon — one shared convention so the curve, the "now"
 *  readout and the chart's step edges all agree. */
function doseInstantMs(date: string): number {
	return new Date(`${date}T12:00:00`).getTime();
}

/** Sum of each logged dose's exponential-decay remainder as of `now`. Doses are anchored to noon on
 *  their logged date (a dose row has no reliable time-of-day), so the curve moves smoothly through the
 *  day rather than stepping once at midnight. A future-dated dose is ignored; one more than 20
 *  half-lives old is skipped rather than computed (< 1e-6 of the original amount either way). */
export function activeAmountMcg(
	doses: { doseMcg: number; date: string }[],
	halfLifeHours: number | null | undefined,
	now: Date = new Date()
): number {
	if (halfLifeHours == null || !Number.isFinite(halfLifeHours) || halfLifeHours <= 0) return 0;
	let total = 0;
	for (const d of doses) {
		if (!Number.isFinite(d.doseMcg) || d.doseMcg <= 0) continue;
		const dosedAtMs = doseInstantMs(d.date);
		if (!Number.isFinite(dosedAtMs)) continue;
		const elapsedHours = (now.getTime() - dosedAtMs) / 3_600_000;
		if (elapsedHours < 0) continue;
		const halfLivesElapsed = elapsedHours / halfLifeHours;
		if (halfLivesElapsed > 20) continue;
		total += d.doseMcg * Math.pow(0.5, halfLivesElapsed);
	}
	return total;
}

/** One sample of the estimated level curve: `t` is an epoch-ms instant, `mcg` the amount still active. */
export type LevelPoint = { t: number; mcg: number };

/** The same decay math as activeAmountMcg, sampled across [fromMs, toMs] so it can be drawn as a curve.
 *  On top of a uniform grid of `maxSamples` points it pins two samples per dose — one a millisecond
 *  before it lands, one at it — so each dose reads as the vertical step it really is instead of a ramp
 *  smeared across however many hours the grid happens to step by. Returned ascending by time. */
export function levelSeries(
	doses: { doseMcg: number; date: string }[],
	halfLifeHours: number | null | undefined,
	fromMs: number,
	toMs: number,
	maxSamples = 200
): LevelPoint[] {
	if (halfLifeHours == null || !Number.isFinite(halfLifeHours) || halfLifeHours <= 0) return [];
	if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return [];
	const times = new Set<number>();
	const step = (toMs - fromMs) / Math.max(1, maxSamples - 1);
	for (let i = 0; i < maxSamples; i++) times.add(Math.round(fromMs + i * step));
	for (const d of doses) {
		const at = doseInstantMs(d.date);
		if (!Number.isFinite(at) || at <= fromMs || at > toMs) continue;
		times.add(at - 1);
		times.add(at);
	}
	return [...times].sort((a, b) => a - b).map((t) => ({ t, mcg: activeAmountMcg(doses, halfLifeHours, new Date(t)) }));
}

/** An estimated level split into number + unit, so callers can style the unit separately (StatCard) or
 *  join it (formatLevel). Deliberately coarser than formatDose, which keeps three decimals of a mg:
 *  microgram precision on a curve this approximate would claim accuracy the math doesn't have. */
export function levelParts(mcg: number | null | undefined): { value: string; unit: string } {
	if (mcg == null || !Number.isFinite(mcg)) return { value: '—', unit: '' };
	if (mcg >= 1000) return { value: (mcg / 1000).toLocaleString(undefined, { maximumFractionDigits: 2 }), unit: 'mg' };
	return { value: Math.round(mcg).toLocaleString(), unit: 'mcg' };
}

/** levelParts as one string, for running text. */
export function formatLevel(mcg: number | null | undefined): string {
	const { value, unit } = levelParts(mcg);
	return unit ? `${value} ${unit}` : value;
}

/** "6 days" / "18 hours" — labels a half-life value in forms and summaries. */
export function formatHalfLife(hours: number | null | undefined): string {
	if (hours == null || !Number.isFinite(hours) || hours <= 0) return '—';
	if (hours >= 24) {
		const days = round(hours / 24, 1);
		return `${days} day${days === 1 ? '' : 's'}`;
	}
	const h = round(hours, 1);
	return `${h} hour${h === 1 ? '' : 's'}`;
}
