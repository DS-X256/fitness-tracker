// Schedule + cycle math for peptide protocols. Pure and dependency-light (only the shared ISO-date
// helpers), so it runs identically on client and server. Works on 'YYYY-MM-DD' local-date strings, the
// same convention the rest of the app uses.

import { isValidIsoDate, shiftIsoDate } from './isoDate';

export type Frequency = 'daily' | 'eod' | 'weekly' | 'x_per_week';

export const FREQUENCY_LABELS: Record<Frequency, string> = {
	daily: 'Every day',
	eod: 'Every other day',
	weekly: 'Specific weekdays',
	x_per_week: 'Times per week (flexible)'
};

export function isFrequency(v: unknown): v is Frequency {
	return v === 'daily' || v === 'eod' || v === 'weekly' || v === 'x_per_week';
}

export type ProtocolSchedule = {
	frequency: Frequency;
	/** Bitmask, bit d set = weekday d is a dosing day (0=Sun … 6=Sat). Used when frequency = 'weekly'. */
	weekdayMask?: number | null;
	/** Target doses per week when frequency = 'x_per_week'. */
	perWeek?: number | null;
	startDate: string;
	endDate?: string | null;
	cycleWeeksOn?: number | null;
	cycleWeeksOff?: number | null;
};

/** An optional higher/lower front-loaded stretch at the start of a protocol (e.g. a heavier dose for
 *  the first N days before dropping to the ongoing maintenance dose) — the schedule (frequency/weekday/
 *  perWeek) stays whatever the protocol already specifies; only the dose amount changes for those days.
 *  `durationDays` is measured from the protocol's startDate, day 0 inclusive. */
export type LoadingPhase = {
	doseMcg: number;
	durationDays: number;
};

const WEEKDAY_ABBR = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

/** Days from `fromIso` to `toIso` (built at local noon to sidestep DST edges, like shiftIsoDate). */
export function daysBetween(fromIso: string, toIso: string): number {
	const [ay, am, ad] = fromIso.split('-').map(Number);
	const [by, bm, bd] = toIso.split('-').map(Number);
	const a = new Date(ay, am - 1, ad, 12).getTime();
	const b = new Date(by, bm - 1, bd, 12).getTime();
	return Math.round((b - a) / 86_400_000);
}

export function weekdayOf(iso: string): number {
	const [y, m, d] = iso.split('-').map(Number);
	return new Date(y, m - 1, d, 12).getDay();
}

/** Human summary of which weekdays a mask selects, e.g. "Mo, We, Fr". */
export function weekdayMaskLabel(mask: number | null | undefined): string {
	if (!mask) return '—';
	return WEEKDAY_ABBR.filter((_, d) => (mask & (1 << d)) !== 0).join(', ');
}

export type CyclePhase = 'on' | 'off' | 'none';
export type CycleState = {
	phase: CyclePhase;
	/** 1-based week number within the current cycle (null when no cycle configured). */
	weekInCycle: number | null;
	/** 1-based day within the current on/off phase. */
	dayInPhase: number | null;
	/** ISO date the next on↔off transition happens (null when no cycle). */
	nextTransition: string | null;
};

/** Where `date` falls in an on/off cycle measured from startDate. 'none' when no cycle is configured. */
export function cycleState(s: ProtocolSchedule, date: string): CycleState {
	const on = s.cycleWeeksOn ?? 0;
	const off = s.cycleWeeksOff ?? 0;
	if (on <= 0 || off <= 0) return { phase: 'none', weekInCycle: null, dayInPhase: null, nextTransition: null };
	const elapsed = daysBetween(s.startDate, date);
	if (elapsed < 0) return { phase: 'off', weekInCycle: null, dayInPhase: null, nextTransition: s.startDate };
	const cycleLen = (on + off) * 7;
	const dayInCycle = elapsed % cycleLen;
	const onDays = on * 7;
	const phase: CyclePhase = dayInCycle < onDays ? 'on' : 'off';
	const daysToNext = phase === 'on' ? onDays - dayInCycle : cycleLen - dayInCycle;
	return {
		phase,
		weekInCycle: Math.floor(dayInCycle / 7) + 1,
		dayInPhase: (phase === 'on' ? dayInCycle : dayInCycle - onDays) + 1,
		nextTransition: shiftIsoDate(date, daysToNext)
	};
}

/** Is a dose scheduled on `date` under this protocol? (Whether it was actually logged is separate.)
 *  'x_per_week' is a flexible weekly target, not a specific-day schedule, so it's never a hard "due". */
export function isDueOn(s: ProtocolSchedule, date: string): boolean {
	if (!isValidIsoDate(date)) return false;
	if (date < s.startDate) return false;
	if (s.endDate && date > s.endDate) return false;
	if (cycleState(s, date).phase === 'off') return false;
	switch (s.frequency) {
		case 'daily':
			return true;
		case 'eod':
			return daysBetween(s.startDate, date) % 2 === 0;
		case 'weekly':
			return ((s.weekdayMask ?? 0) & (1 << weekdayOf(date))) !== 0;
		case 'x_per_week':
			return false;
		default:
			return false;
	}
}

/** Is `date` still inside the loading window (day 0 = startDate)? False when no loading phase is
 *  configured, or once `durationDays` has elapsed. Doesn't check whether a dose is actually due on
 *  `date` — combine with isDueOn for that. */
export function isLoadingPhaseOn(startDate: string, loading: LoadingPhase | null | undefined, date: string): boolean {
	if (!loading || loading.durationDays <= 0) return false;
	const elapsed = daysBetween(startDate, date);
	return elapsed >= 0 && elapsed < loading.durationDays;
}

/** The ISO date the loading phase hands off to maintenance dosing (the first non-loading day), or
 *  null when no loading phase is configured. */
export function loadingEndDate(startDate: string, loading: LoadingPhase | null | undefined): string | null {
	if (!loading || loading.durationDays <= 0) return null;
	return shiftIsoDate(startDate, loading.durationDays);
}

/** The dose that actually applies on `date`: the loading dose while isLoadingPhaseOn, otherwise the
 *  protocol's own maintenance dose. */
export function effectiveDoseMcg(
	maintenanceDoseMcg: number,
	startDate: string,
	loading: LoadingPhase | null | undefined,
	date: string
): number {
	return isLoadingPhaseOn(startDate, loading, date) ? loading!.doseMcg : maintenanceDoseMcg;
}

/** Count of scheduled doses across [fromIso, toIso] inclusive — the denominator for adherence.
 *  For 'x_per_week', counts perWeek per whole week in range (approximate, since days aren't fixed). */
export function scheduledCount(s: ProtocolSchedule, fromIso: string, toIso: string): number {
	const span = daysBetween(fromIso, toIso);
	if (span < 0) return 0;
	if (s.frequency === 'x_per_week') {
		const weeks = (span + 1) / 7;
		return Math.round(weeks * (s.perWeek ?? 0));
	}
	let count = 0;
	for (let i = 0; i <= span; i++) {
		if (isDueOn(s, shiftIsoDate(fromIso, i))) count++;
	}
	return count;
}
