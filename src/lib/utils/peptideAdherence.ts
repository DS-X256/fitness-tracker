// The ONE adherence engine for peptide protocols. The dashboard card, the calendar, the compound hub, the
// AI summary and the AI Coach's tools all score adherence through this file, so they can never disagree
// about "12 of 14" again (they used to: the AI counted any-day doses, the dashboard only due-day ones).
//
// Model: a protocol has scheduled SLOTS per day (peptideSchedule.slotsOn — 0 on rest days, 2 on a 2×/day
// day). Logged doses fill slots first, then deliberate skips; a slot left unfilled is `missed` once its
// day is over, or `pending` while it's still today. Doses beyond a day's slots are `extra` (logged, but
// nothing was scheduled), never negative adherence. 'x_per_week' has no fixed days, so it's scored per
// Monday–Sunday week against a pro-rated weekly target, and a week can only be "missed" once it's over.
//
// Pure and dependency-light (schedule helpers only), like the rest of $lib/utils, so it runs on client
// and server alike and can be exercised with a plain script.

import { shiftIsoDate, isoWeekStart } from './isoDate';
import { daysBetween, isWithinActiveSpan, slotsOn, targetDoseOn, type ProtocolDoseFields, type ProtocolSchedule } from './peptideSchedule';
import type { DoseKind } from './peptides';

export type AdherenceProtocol = ProtocolSchedule &
	ProtocolDoseFields & {
		id: number;
		peptideId: number;
	};

export type AdherenceDose = {
	id: number;
	peptideId: number;
	protocolId: number | null;
	date: string;
	kind: DoseKind;
	doseMcg: number;
};

/** Which protocol each dose/skip counts toward (doseId → protocolId, or null for "no protocol"):
 *  - an explicit protocolId wins when it points at a protocol of the same compound;
 *  - otherwise the dose goes to a same-compound protocol that had something scheduled that day (the one
 *    with the fewest slots already filled, so AM/PM protocols of one compound share out sensibly), then
 *    to any same-compound protocol whose active span covers the day.
 *  Primes and patch removals are never assigned — they aren't doses. A blend dose is logged against the
 *  blend's own compound, so it counts toward the blend's protocol and never toward a component's. */
export function assignDoses(
	protocols: AdherenceProtocol[],
	doses: AdherenceDose[],
	/** Which protocols an UNLINKED dose may be matched to (default: all). Pass the active ones so a paused
	 *  protocol keeps the doses explicitly logged under it without soaking up new unlinked ones. */
	canTakeUnlinked: (p: AdherenceProtocol) => boolean = () => true
): Map<number, number | null> {
	const out = new Map<number, number | null>();
	const byId = new Map(protocols.map((p) => [p.id, p]));
	const filled = new Map<string, number>(); // `${protocolId}|${date}` → doses/skips assigned so far
	const bump = (pid: number, date: string) => filled.set(`${pid}|${date}`, (filled.get(`${pid}|${date}`) ?? 0) + 1);

	const countable = doses.filter((d) => d.kind === 'dose' || d.kind === 'skip');
	// Explicitly linked rows first, so the fallback matching below sees their slots as already taken.
	for (const d of countable) {
		const p = d.protocolId != null ? byId.get(d.protocolId) : undefined;
		if (p && p.peptideId === d.peptideId) {
			out.set(d.id, p.id);
			bump(p.id, d.date);
		}
	}
	for (const d of countable) {
		if (out.has(d.id)) continue;
		const candidates = protocols.filter((p) => p.peptideId === d.peptideId && canTakeUnlinked(p) && isWithinActiveSpan(p, d.date));
		const withSlots = candidates.filter((p) => slotsOn(p, d.date) > 0 || p.frequency === 'x_per_week');
		const pool = withSlots.length > 0 ? withSlots : candidates;
		if (pool.length === 0) {
			out.set(d.id, null);
			continue;
		}
		const best = pool.reduce((a, b) =>
			(filled.get(`${b.id}|${d.date}`) ?? 0) < (filled.get(`${a.id}|${d.date}`) ?? 0) ? b : a
		);
		out.set(d.id, best.id);
		bump(best.id, d.date);
	}
	return out;
}

export type DayStatus = 'rest' | 'taken' | 'partial' | 'skipped' | 'missed' | 'pending' | 'extra';

export type AdherenceDay = {
	date: string;
	slots: number;
	taken: number;
	skipped: number;
	/** Per-dose target that day (loading/taper aware) — what a logged dose should be compared against. */
	targetMcg: number;
	status: DayStatus;
};

export type AdherenceWeek = {
	weekStart: string;
	/** Pro-rated weekly target (fewer when the protocol only covers part of the week/window). */
	target: number;
	taken: number;
	skipped: number;
	complete: boolean;
};

export type AdherenceTotals = {
	scheduled: number;
	taken: number;
	skipped: number;
	missed: number;
	pending: number;
	extra: number;
};

export type ProtocolAdherence = {
	protocolId: number;
	days: AdherenceDay[];
	weeks: AdherenceWeek[];
	totals: AdherenceTotals;
};

const emptyTotals = (): AdherenceTotals => ({ scheduled: 0, taken: 0, skipped: 0, missed: 0, pending: 0, extra: 0 });

/** Scores one protocol over [from, to] (inclusive; clipped to the protocol's own start/end and to
 *  `today` — the future is never scored). `doses` should be the rows assignDoses() gave this protocol;
 *  anything else in the list is ignored by id-free filtering on kind only, so pass the right subset. */
export function protocolAdherence(
	p: AdherenceProtocol,
	doses: AdherenceDose[],
	from: string,
	to: string,
	today: string
): ProtocolAdherence {
	const totals = emptyTotals();
	const days: AdherenceDay[] = [];
	const weeks: AdherenceWeek[] = [];
	const start = from > p.startDate ? from : p.startDate;
	let end = to < today ? to : today;
	if (p.endDate && p.endDate < end) end = p.endDate;
	if (start > end) return { protocolId: p.id, days, weeks, totals };

	const takenOn = new Map<string, number>();
	const skippedOn = new Map<string, number>();
	for (const d of doses) {
		if (d.kind === 'dose') takenOn.set(d.date, (takenOn.get(d.date) ?? 0) + 1);
		else if (d.kind === 'skip') skippedOn.set(d.date, (skippedOn.get(d.date) ?? 0) + 1);
	}

	if (p.frequency === 'x_per_week') {
		const perWeek = p.perWeek ?? 0;
		let ws = isoWeekStart(start);
		while (ws <= end) {
			let activeDays = 0;
			let taken = 0;
			let skipped = 0;
			for (let i = 0; i < 7; i++) {
				const d = shiftIsoDate(ws, i);
				if (d < start || d > end) continue;
				taken += takenOn.get(d) ?? 0;
				skipped += skippedOn.get(d) ?? 0;
			}
			// Capacity counts the protocol's active days in this week (within the window) — including the
			// current week's days still ahead, since that week is open (pending), not scored as missed.
			const weekEnd = shiftIsoDate(ws, 6);
			const capEnd = to >= today ? weekEnd : to;
			for (let i = 0; i < 7; i++) {
				const d = shiftIsoDate(ws, i);
				if (d >= start && d <= capEnd && isWithinActiveSpan(p, d)) activeDays++;
			}
			const target = Math.round((perWeek * activeDays) / 7);
			const complete = weekEnd < today;
			const filled = Math.min(taken, target);
			const skipFill = Math.min(skipped, target - filled);
			totals.scheduled += target;
			totals.taken += filled;
			totals.skipped += skipFill;
			totals.extra += Math.max(0, taken - target);
			const open = target - filled - skipFill;
			if (complete) totals.missed += open;
			else totals.pending += open;
			weeks.push({ weekStart: ws, target, taken, skipped, complete });
			ws = shiftIsoDate(ws, 7);
		}
		for (let i = 0; i <= daysBetween(start, end); i++) {
			const d = shiftIsoDate(start, i);
			const taken = takenOn.get(d) ?? 0;
			const skipped = skippedOn.get(d) ?? 0;
			days.push({ date: d, slots: 0, taken, skipped, targetMcg: targetDoseOn(p, d), status: taken > 0 ? 'taken' : skipped > 0 ? 'skipped' : 'rest' });
		}
		return { protocolId: p.id, days, weeks, totals };
	}

	for (let i = 0; i <= daysBetween(start, end); i++) {
		const d = shiftIsoDate(start, i);
		const slots = slotsOn(p, d);
		const taken = takenOn.get(d) ?? 0;
		const skipped = skippedOn.get(d) ?? 0;
		const filled = Math.min(taken, slots);
		const skipFill = Math.min(skipped, slots - filled);
		const open = slots - filled - skipFill;
		totals.scheduled += slots;
		totals.taken += filled;
		totals.skipped += skipFill;
		totals.extra += Math.max(0, taken - slots);
		if (d < today) totals.missed += open;
		else totals.pending += open;

		let status: DayStatus;
		if (slots === 0) status = taken > 0 ? 'extra' : 'rest';
		else if (open === 0) status = filled === slots ? 'taken' : filled > 0 ? 'partial' : 'skipped';
		else if (d === today) status = filled > 0 ? 'partial' : 'pending';
		else status = filled > 0 ? 'partial' : 'missed';
		days.push({ date: d, slots, taken, skipped, targetMcg: targetDoseOn(p, d), status });
	}
	return { protocolId: p.id, days, weeks, totals };
}

/** Sums several protocols' totals. */
export function sumTotals(list: AdherenceTotals[]): AdherenceTotals {
	const t = emptyTotals();
	for (const x of list) {
		t.scheduled += x.scheduled;
		t.taken += x.taken;
		t.skipped += x.skipped;
		t.missed += x.missed;
		t.pending += x.pending;
		t.extra += x.extra;
	}
	return t;
}

/** Adherence % = taken ÷ (taken + missed). Deliberate skips and still-pending slots are neither credit
 *  nor penalty — they're shown separately. Null when nothing was due yet. */
export function adherencePct(t: AdherenceTotals): number | null {
	const denom = t.taken + t.missed;
	return denom > 0 ? Math.round((t.taken / denom) * 100) : null;
}

/** Today's state for one protocol — what the "Due today" row needs. For 'x_per_week' it reports the
 *  current week's progress instead of day slots. */
export type TodayState =
	| { mode: 'slots'; slots: number; taken: number; skipped: number; pending: number; targetMcg: number }
	| { mode: 'weekly'; target: number; taken: number; skipped: number; remaining: number; targetMcg: number };

export function todayState(p: AdherenceProtocol, doses: AdherenceDose[], today: string): TodayState {
	if (p.frequency === 'x_per_week') {
		const ws = isoWeekStart(today);
		const a = protocolAdherence(p, doses, ws, shiftIsoDate(ws, 6), today);
		// The current week is still open, so its target covers the whole week, not just days elapsed.
		const week = a.weeks[0];
		const target = week?.target ?? 0;
		const taken = week?.taken ?? 0;
		const skipped = week?.skipped ?? 0;
		return { mode: 'weekly', target, taken, skipped, remaining: Math.max(0, target - taken - skipped), targetMcg: targetDoseOn(p, today) };
	}
	const slots = slotsOn(p, today);
	let taken = 0;
	let skipped = 0;
	for (const d of doses) {
		if (d.date !== today) continue;
		if (d.kind === 'dose') taken++;
		else if (d.kind === 'skip') skipped++;
	}
	const filled = Math.min(taken, slots);
	const skipFill = Math.min(skipped, slots - filled);
	return { mode: 'slots', slots, taken, skipped, pending: slots - filled - skipFill, targetMcg: targetDoseOn(p, today) };
}

/** Calendar cell per date across all protocols: the worst-first merge of each protocol's day status,
 *  plus dose count (real doses only) so unscheduled logging still paints the day. */
export type CalendarDay = { date: string; count: number; status: DayStatus };

export function calendarDays(perProtocol: ProtocolAdherence[], allDoses: AdherenceDose[], from: string, to: string): CalendarDay[] {
	const rank: Record<DayStatus, number> = { missed: 6, partial: 5, pending: 4, skipped: 3, taken: 2, extra: 1, rest: 0 };
	const statusOn = new Map<string, DayStatus>();
	for (const pa of perProtocol) {
		for (const d of pa.days) {
			if (d.status === 'rest') continue;
			const cur = statusOn.get(d.date);
			if (!cur || rank[d.status] > rank[cur]) statusOn.set(d.date, d.status);
		}
	}
	const counts = new Map<string, number>();
	for (const d of allDoses) if (d.kind === 'dose') counts.set(d.date, (counts.get(d.date) ?? 0) + 1);
	const out: CalendarDay[] = [];
	for (let i = 0; i <= daysBetween(from, to); i++) {
		const date = shiftIsoDate(from, i);
		const count = counts.get(date) ?? 0;
		out.push({ date, count, status: statusOn.get(date) ?? (count > 0 ? 'extra' : 'rest') });
	}
	return out;
}
