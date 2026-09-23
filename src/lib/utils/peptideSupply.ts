// Supply projection: how long a container (or a compound's whole stock) lasts on the user's own
// schedule. Replaces the old `daysOfSupply(remaining, protocolDose)`, which divided by the PER-DOSE amount
// and called the result days — so a weekly GLP-1 with 16 doses left read "16 days" instead of ~16 weeks,
// and loading/taper doses, 2×/day schedules and EOD rhythms were all ignored.
//
// Pure, no dependencies beyond the schedule engine. Simulates day by day from today forward using the
// same slotsOn()/targetDoseOn() the rest of the app schedules with; 'x_per_week' is spread as a daily
// fraction of its weekly target (it has no fixed days to simulate).

import { shiftIsoDate } from './isoDate';
import { isWithinActiveSpan, slotsOn, targetDoseOn, type ProtocolDoseFields, type ProtocolSchedule } from './peptideSchedule';

export type SupplyProtocol = ProtocolSchedule & ProtocolDoseFields;

export type RunoutProjection = {
	/** Whole doses the remaining amount covers at the per-dose targets coming up. */
	dosesLeft: number;
	/** Days until the supply can't cover the next scheduled dose (0 = can't cover today's). Null when the
	 *  schedule never consumes anything within the horizon (paused / ended / nothing scheduled). */
	daysLeft: number | null;
	/** First date the supply falls short, or null (see daysLeft). */
	runsOutOn: string | null;
	/** True when the schedule does consume it but it lasts past the one-year projection horizon. */
	beyondHorizon: boolean;
};

const HORIZON_DAYS = 365;

/** Projects when `remainingMcg` runs out given the protocols drawing on it (usually one). Doses already
 *  logged today are assumed to be in `remainingMcg`, so today's still-pending slots are counted by the
 *  caller passing `pendingTodaySlots`; by default the whole of today's schedule counts. */
export function projectRunout(
	remainingMcg: number,
	protocols: SupplyProtocol[],
	today: string,
	opts: { pendingTodaySlots?: number } = {}
): RunoutProjection {
	let left = Math.max(0, remainingMcg);
	let doses = 0;
	let consumedAnything = false;
	for (let i = 0; i <= HORIZON_DAYS; i++) {
		const date = shiftIsoDate(today, i);
		for (const p of protocols) {
			let slots: number;
			if (p.frequency === 'x_per_week') {
				slots = isWithinActiveSpan(p, date) ? (p.perWeek ?? 0) / 7 : 0;
			} else {
				slots = slotsOn(p, date);
			}
			if (i === 0 && opts.pendingTodaySlots != null && p.frequency !== 'x_per_week') {
				slots = Math.min(slots, opts.pendingTodaySlots);
			}
			if (slots <= 0) continue;
			const per = targetDoseOn(p, date);
			if (!(per > 0)) continue;
			consumedAnything = true;
			const need = per * slots;
			if (left + 1e-9 < need) {
				// Partial coverage on a multi-slot/fractional day still counts the whole doses it can cover.
				return { dosesLeft: Math.floor(doses + left / per + 1e-9), daysLeft: i, runsOutOn: date, beyondHorizon: false };
			}
			left -= need;
			doses += slots;
		}
	}
	return { dosesLeft: Math.floor(doses + 1e-9), daysLeft: null, runsOutOn: null, beyondHorizon: consumedAnything };
}

/** Simple doses-left figure for a remaining amount at one per-dose size (no schedule needed). */
export function dosesCovered(remainingMcg: number, perDoseMcg: number): number {
	if (!(perDoseMcg > 0) || !(remainingMcg > 0)) return 0;
	return Math.floor(remainingMcg / perDoseMcg + 1e-9);
}
