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
 *  applying the patch already recorded, so it's excluded from consumption too (see mcgConsumedByVial). */
export type DoseKind = 'dose' | 'prime' | 'remove';

export function isDoseKind(v: unknown): v is DoseKind {
	return v === 'dose' || v === 'prime' || v === 'remove';
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
