// "What actually went in": expands the dose log into per-compound intake, splitting every blend dose into
// its components. A logged "4 mg KLOW" becomes GHK-Cu 2.5 mg + BPC-157 500 mcg + TB-500 500 mcg + KPV
// 500 mcg here, and every consumer that asks "how much X did I take" — history, the compound hub, level
// curves, the AI summary and the AI Coach — reads intake from this one function instead of the raw rows.
//
// Split source, in order: the split snapshotted onto the dose when it was logged (so editing a blend's
// ratio later never rewrites history); for rows logged before snapshots existed, the blend's CURRENT
// ratio, flagged `estimated`. Only one level deep — a blend's components are never blends themselves
// (enforced on save, see repositories/peptides.ts).
//
// Per $lib/utils/peptides and PEPTIDE_MULTIROUTE_PROMPT.md: amounts are never summed across routes (no
// bioavailability model exists here), so every aggregate below is keyed by (compound, route).

import { normalizeCompoundName, splitBlendDose, type AdminRoute, type BlendComponent, type BlendPortion, type DoseKind } from './peptides';

export type IntakeCompound = {
	id: number;
	name: string;
	isBlend: boolean;
	components: BlendComponent[] | null;
};

export type IntakeDose = {
	id: number;
	peptideId: number;
	date: string;
	time: string | null;
	route: AdminRoute | null;
	kind: DoseKind;
	doseMcg: number;
	/** The split recorded at log time (null = not a blend dose). */
	components: BlendPortion[] | null;
	/** False for rows written before splits were recorded — those get split by the current ratio. */
	splitRecorded: boolean;
};

export type IntakeEntry = {
	doseId: number;
	date: string;
	time: string | null;
	route: AdminRoute | null;
	/** The compound this intake is attributed to (null only if a component can't be matched to any row). */
	peptideId: number | null;
	name: string;
	mcg: number;
	/** Set when this intake came from a blend dose — the blend compound it was logged as. */
	viaBlendId: number | null;
	viaBlendName: string | null;
	/** True when the split was reconstructed from the blend's current ratio rather than recorded. */
	estimated: boolean;
};

/** Resolves a portion/component to a compound id: its own link first, else a name match. */
function resolveId(
	portion: { peptideId?: number | null; name: string },
	byId: Map<number, IntakeCompound>,
	byName: Map<string, number>
): number | null {
	if (portion.peptideId != null && byId.has(portion.peptideId)) return portion.peptideId;
	return byName.get(normalizeCompoundName(portion.name)) ?? null;
}

export function expandIntake(doses: IntakeDose[], compounds: IntakeCompound[]): IntakeEntry[] {
	const byId = new Map(compounds.map((c) => [c.id, c]));
	const byName = new Map<string, number>();
	for (const c of compounds) if (!c.isBlend) byName.set(normalizeCompoundName(c.name), c.id);

	const out: IntakeEntry[] = [];
	for (const d of doses) {
		if (d.kind !== 'dose' || !(d.doseMcg > 0)) continue;
		const compound = byId.get(d.peptideId);
		const base = { doseId: d.id, date: d.date, time: d.time, route: d.route };

		let portions: BlendPortion[] | null = null;
		let estimated = false;
		if (d.splitRecorded && d.components && d.components.length > 0) {
			portions = d.components;
		} else if (!d.splitRecorded && compound?.isBlend && compound.components && compound.components.length > 0) {
			portions = splitBlendDose(d.doseMcg, compound.components);
			estimated = true;
		}

		if (!portions) {
			out.push({ ...base, peptideId: d.peptideId, name: compound?.name ?? 'Unknown', mcg: d.doseMcg, viaBlendId: null, viaBlendName: null, estimated: false });
			continue;
		}
		for (const p of portions) {
			if (!(p.mcg > 0)) continue;
			const id = resolveId(p, byId, byName);
			out.push({
				...base,
				peptideId: id,
				name: id != null ? (byId.get(id)?.name ?? p.name) : p.name,
				mcg: p.mcg,
				viaBlendId: d.peptideId,
				viaBlendName: compound?.name ?? null,
				estimated
			});
		}
	}
	return out;
}

export type IntakeTotal = {
	peptideId: number | null;
	name: string;
	route: AdminRoute | null;
	totalMcg: number;
	doseCount: number;
	/** Portion of totalMcg that came from blends (vs. taken on its own). */
	viaBlendMcg: number;
	firstDate: string;
	lastDate: string;
	estimated: boolean;
};

/** Totals per (compound, route) — never across routes. */
export function intakeTotals(entries: IntakeEntry[]): IntakeTotal[] {
	const map = new Map<string, IntakeTotal>();
	for (const e of entries) {
		const key = `${e.peptideId ?? `name:${normalizeCompoundName(e.name)}`}|${e.route ?? ''}`;
		const cur = map.get(key);
		if (!cur) {
			map.set(key, {
				peptideId: e.peptideId,
				name: e.name,
				route: e.route,
				totalMcg: e.mcg,
				doseCount: 1,
				viaBlendMcg: e.viaBlendId != null ? e.mcg : 0,
				firstDate: e.date,
				lastDate: e.date,
				estimated: e.estimated
			});
			continue;
		}
		cur.totalMcg += e.mcg;
		cur.doseCount++;
		if (e.viaBlendId != null) cur.viaBlendMcg += e.mcg;
		if (e.date < cur.firstDate) cur.firstDate = e.date;
		if (e.date > cur.lastDate) cur.lastDate = e.date;
		cur.estimated ||= e.estimated;
	}
	return [...map.values()].map((t) => ({ ...t, totalMcg: Math.round(t.totalMcg * 1000) / 1000, viaBlendMcg: Math.round(t.viaBlendMcg * 1000) / 1000 }));
}

/** The {date, doseMcg} series activeAmountMcg/levelSeries need for one compound on one route, including
 *  what arrived via blends. */
export function levelDoses(entries: IntakeEntry[], peptideId: number, route: AdminRoute | null): { date: string; doseMcg: number }[] {
	return entries.filter((e) => e.peptideId === peptideId && e.route === route).map((e) => ({ date: e.date, doseMcg: e.mcg }));
}

/** Distinct routes a compound has intake on (for per-route level curves). */
export function intakeRoutes(entries: IntakeEntry[], peptideId: number): (AdminRoute | null)[] {
	return [...new Set(entries.filter((e) => e.peptideId === peptideId).map((e) => e.route))];
}
