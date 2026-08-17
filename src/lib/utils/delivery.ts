// Non-injection delivery math — pure arithmetic, no medical judgement (same spirit as reconstitution.ts,
// which stays the source of truth for syringe draws). Nasal sprays, topical drops/pumps and dropper
// bottles all reduce to one identity:
//
//   concentration (mg/mL) × volume (µL) ≡ micrograms per actuation
//
// ...because 1 mg/mL is exactly 1 µg/µL, so multiplying a mg/mL concentration by a microliter volume
// yields micrograms with no unit-conversion factor in between. A percent-strength (% w/v) solution
// converts to mg/mL first: 1% w/v = 1 g/100 mL = 10 mg/mL.
//
// Worked examples (verified against this file before it was wired into any schema/UI):
//   Nasal:    10 mg in 5 mL = 2 mg/mL, 100 µL pump   → mcgPerActuation(2, 100)  = 200 mcg/spray
//   Nasal:    10 mg in 10 mL = 1 mg/mL, 100 µL pump  → mcgPerActuation(1, 100)  = 100 mcg/spray
//   Bottle:   5 mL @ 100 µL, 3 priming actuations    → actuationsPerContainer(5, 100, 3) = {total: 50, usable: 47}
//   Topical:  3% serum = 30 mg/mL, 4 drops @ 50 µL   → 4 × mcgPerActuation(30, 50) = 6000 mcg
//   Oral:     500 mcg/capsule × 2                    → doseFromUnits(2, 500) = 1000 mcg
//
// Rule this file never breaks: it never sums micrograms across routes and never multiplies by a
// bioavailability factor. Nasal/oral/transdermal bioavailability differs by more than an order of
// magnitude and is compound-specific — any such conversion would be invented pharmacokinetics
// presented as fact. Every function here stays within a single route's own units.

/** 1% w/v = 1 g / 100 mL = 10 mg/mL. */
export function percentToMgMl(percent: number): number {
	return percent * 10;
}

/** Micrograms delivered by one actuation (spray/pump/drop) of a solution at this concentration. */
export function mcgPerActuation(concentrationMgMl: number, volumeUl: number): number {
	return concentrationMgMl * volumeUl;
}

/** Whole actuations that fit a target dose, plus the mcg left over that a whole-actuation count can't
 *  hit exactly — e.g. a 300 mcg target at 200 mcg/spray is 1 whole spray with 100 mcg left over. */
export function actuationsForDose(doseMcg: number, mcgPerActuation: number): { whole: number; remainder: number } {
	if (!(mcgPerActuation > 0) || !(doseMcg > 0)) return { whole: 0, remainder: Math.max(0, doseMcg) };
	const whole = Math.floor(doseMcg / mcgPerActuation);
	return { whole, remainder: doseMcg - whole * mcgPerActuation };
}

/** Actuations in a full container, and how many are actually usable once priming is spent.
 *  1 mL = 1000 µL, so total = volumeMl * 1000 / volumeUl. */
export function actuationsPerContainer(
	volumeMl: number,
	volumeUl: number,
	primingActuations = 0
): { total: number; usable: number } {
	if (!(volumeMl > 0) || !(volumeUl > 0)) return { total: 0, usable: 0 };
	const total = Math.floor((volumeMl * 1000) / volumeUl);
	return { total, usable: Math.max(0, total - Math.max(0, primingActuations)) };
}

/** Whole actuations left in a container given its remaining micrograms — the live "X sprays left" figure. */
export function actuationsRemaining(remainingMcg: number, mcgPerActuation: number): number {
	if (!(mcgPerActuation > 0) || !(remainingMcg > 0)) return 0;
	return Math.floor(remainingMcg / mcgPerActuation);
}

/** Whole days a remaining supply covers at a given daily dose. Infinity when nothing is being consumed
 *  (dailyMcg <= 0), so callers can render "—" rather than a division artefact. */
export function daysOfSupply(remainingMcg: number, dailyMcg: number): number {
	if (!(dailyMcg > 0)) return Infinity;
	if (!(remainingMcg > 0)) return 0;
	return Math.floor(remainingMcg / dailyMcg);
}

/** Splits a spray count across nostrils as evenly as possible; the left nostril takes the odd one out. */
export function nostrilSplit(sprays: number): [number, number] {
	const n = Math.max(0, Math.floor(sprays));
	const left = Math.ceil(n / 2);
	const right = Math.floor(n / 2);
	return [left, right];
}

/** Total micrograms from a whole-unit dose (capsules, patches, pre-dosed drops) of known mass each. */
export function doseFromUnits(unitCount: number, unitMassMcg: number): number {
	return unitCount * unitMassMcg;
}

/** Resolves a container's mg/mL strength from whichever field it was actually recorded with: a direct
 *  concentration, a percent w/v, or (mirroring reconstitution.ts) mg of powder dissolved in mL of
 *  diluent. Returns null when none of those are present yet — callers fall back to manual dose entry. */
export function containerConcentrationMgMl(container: {
	concentrationMgMl?: number | null;
	percentWv?: number | null;
	vialMg?: number | null;
	bacWaterMl?: number | null;
}): number | null {
	if (container.concentrationMgMl != null && container.concentrationMgMl > 0) return container.concentrationMgMl;
	if (container.percentWv != null && container.percentWv > 0) return percentToMgMl(container.percentWv);
	if (container.vialMg != null && container.vialMg > 0 && container.bacWaterMl != null && container.bacWaterMl > 0) {
		return container.vialMg / container.bacWaterMl;
	}
	return null;
}

/** Total micrograms a container holds when full/fresh — the numerator for live remaining-supply tracking
 *  (pair with a consumed-mcg total from logged doses, then actuationsRemaining/daysOfSupply above).
 *  'vial' is mg of powder; 'nasal_spray'/'serum' is concentration × the container's whole volume;
 *  'capsules'/'patches' is a declared unit count × mass-per-unit. Null when the container doesn't carry
 *  enough information yet (e.g. a spray bottle with no volume recorded). */
export function containerTotalMcg(container: {
	form: string;
	vialMg?: number | null;
	bacWaterMl?: number | null;
	concentrationMgMl?: number | null;
	percentWv?: number | null;
	unitCount?: number | null;
	unitMassMcg?: number | null;
}): number | null {
	if (container.form === 'capsules' || container.form === 'patches') {
		if (container.unitCount != null && container.unitCount > 0 && container.unitMassMcg != null && container.unitMassMcg > 0) {
			return doseFromUnits(container.unitCount, container.unitMassMcg);
		}
		return null;
	}
	if (container.form === 'vial') {
		return container.vialMg != null && container.vialMg > 0 ? mgToMcgLocal(container.vialMg) : null;
	}
	// nasal_spray / serum: whole-container mg (concentration × volume) converted to mcg.
	const conc = containerConcentrationMgMl(container);
	if (conc == null || !(container.bacWaterMl != null && container.bacWaterMl > 0)) return null;
	return mgToMcgLocal(conc * container.bacWaterMl);
}

/** mg → mcg, spelled out locally rather than importing $lib/utils/peptides's mgToMcg — this file stays
 *  dependency-free by design (same reasoning as reconstitution.ts). */
function mgToMcgLocal(mg: number): number {
	return mg * 1000;
}
