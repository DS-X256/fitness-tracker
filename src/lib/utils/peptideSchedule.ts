// Schedule + cycle math for peptide protocols. Pure and dependency-light (only the shared ISO-date
// helpers), so it runs identically on client and server. Works on 'YYYY-MM-DD' local-date strings, the
// same convention the rest of the app uses.

import { isValidIsoDate, shiftIsoDate } from './isoDate';

export type Frequency = 'daily' | 'eod' | 'every_n_days' | 'weekly' | 'x_per_week';

export const FREQUENCY_LABELS: Record<Frequency, string> = {
	daily: 'Every day',
	eod: 'Every other day',
	every_n_days: 'Every N days',
	weekly: 'Specific weekdays',
	x_per_week: 'Times per week (flexible)'
};

export function isFrequency(v: unknown): v is Frequency {
	return v === 'daily' || v === 'eod' || v === 'every_n_days' || v === 'weekly' || v === 'x_per_week';
}

/** Upper bound on doses in one scheduled day (e.g. BPC-157 or CJC/Ipamorelin split AM/PM). */
export const MAX_TIMES_PER_DAY = 4;
/** Bounds for 'every_n_days' — 2 is the same as 'eod', 30 is "monthly-ish". */
export const MIN_INTERVAL_DAYS = 2;
export const MAX_INTERVAL_DAYS = 30;

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
	/** Days between doses when frequency = 'every_n_days' (anchored to startDate). */
	intervalDays?: number | null;
	/** Doses per scheduled day (1-4). Absent/null means 1 — every protocol written before this existed. */
	timesPerDay?: number | null;
};

/** An optional higher/lower front-loaded stretch at the start of a protocol (e.g. a heavier dose for
 *  the first N days before dropping to the ongoing maintenance dose) — the schedule (frequency/weekday/
 *  perWeek) stays whatever the protocol already specifies; only the dose amount changes for those days.
 *  `durationDays` is measured from the protocol's startDate, day 0 inclusive. */
export type LoadingPhase = {
	doseMcg: number;
	durationDays: number;
};

/** An optional third dose tier that kicks in after a stretch at the regular ("maintenance") dose and
 *  then just keeps applying — e.g. "load high for 3 days, hold the regular dose for 10 days, then step
 *  down for good". Anchored forward from when the regular dose itself starts (right after the loading
 *  phase ends, or from the protocol's startDate if there's no loading phase) rather than backward from an
 *  end date, so it needs no end date to make sense: with one set, the taper dose runs through it same as
 *  everything else; with none, it just runs forever, becoming the new de-facto maintenance dose. Same
 *  schedule (frequency/weekday/perWeek) as the rest of the protocol — only the dose amount changes. */
export type TaperPhase = {
	doseMcg: number;
	/** Days at the regular dose — counted from when the regular dose starts — before switching to
	 *  doseMcg. 0 means "immediately", i.e. skip straight from loading to this dose. */
	afterDays: number;
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

/** Doses per scheduled day, clamped to 1..MAX_TIMES_PER_DAY (legacy protocols have none set → 1). */
export function timesPerDayOf(s: Pick<ProtocolSchedule, 'timesPerDay'>): number {
	const n = s.timesPerDay ?? 1;
	return Number.isInteger(n) && n >= 1 ? Math.min(n, MAX_TIMES_PER_DAY) : 1;
}

/** Is `date` inside the protocol's active span — on/after startDate, on/before endDate, and not in a
 *  cycle's off-phase? The frequency-independent half of "is anything scheduled today". */
export function isWithinActiveSpan(s: ProtocolSchedule, date: string): boolean {
	if (!isValidIsoDate(date)) return false;
	if (date < s.startDate) return false;
	if (s.endDate && date > s.endDate) return false;
	return cycleState(s, date).phase !== 'off';
}

/** How many doses are scheduled on `date` (0 = rest day). 'x_per_week' is a flexible weekly target, not a
 *  specific-day schedule, so it never has fixed slots — see peptideAdherence.ts for how it's scored.
 *  'every_n_days' and 'eod' are anchored to startDate, so a missed day doesn't shift the rhythm. */
export function slotsOn(s: ProtocolSchedule, date: string): number {
	if (!isWithinActiveSpan(s, date)) return 0;
	const perDay = timesPerDayOf(s);
	switch (s.frequency) {
		case 'daily':
			return perDay;
		case 'eod':
			return daysBetween(s.startDate, date) % 2 === 0 ? perDay : 0;
		case 'every_n_days': {
			const n = Math.max(MIN_INTERVAL_DAYS, s.intervalDays ?? MIN_INTERVAL_DAYS);
			return daysBetween(s.startDate, date) % n === 0 ? perDay : 0;
		}
		case 'weekly':
			return ((s.weekdayMask ?? 0) & (1 << weekdayOf(date))) !== 0 ? perDay : 0;
		case 'x_per_week':
			return 0;
		default:
			return 0;
	}
}

/** Is a dose scheduled on `date` under this protocol? (Whether it was actually logged is separate.)
 *  'x_per_week' is a flexible weekly target, not a specific-day schedule, so it's never a hard "due". */
export function isDueOn(s: ProtocolSchedule, date: string): boolean {
	return slotsOn(s, date) > 0;
}

/** Short human description of a schedule: "2× daily", "Every 3 days", "Mo, We, Fr", "3× per week". */
export function scheduleLabel(s: ProtocolSchedule): string {
	const perDay = timesPerDayOf(s);
	const suffix = perDay > 1 ? ` · ${perDay}× a day` : '';
	switch (s.frequency) {
		case 'daily':
			return perDay > 1 ? `${perDay}× daily` : 'Every day';
		case 'eod':
			return `Every other day${suffix}`;
		case 'every_n_days':
			return `Every ${Math.max(MIN_INTERVAL_DAYS, s.intervalDays ?? MIN_INTERVAL_DAYS)} days${suffix}`;
		case 'weekly':
			return `${weekdayMaskLabel(s.weekdayMask)}${suffix}`;
		case 'x_per_week':
			return `${s.perWeek ?? 0}× per week`;
		default:
			return '—';
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

/** The ISO date the taper phase takes over from the regular dose, or null when no taper phase is
 *  configured. That's `taper.afterDays` days after the regular dose itself starts — i.e. after
 *  loadingEndDate, or startDate when there's no loading phase. */
export function taperStartDate(
	startDate: string,
	loading: LoadingPhase | null | undefined,
	taper: TaperPhase | null | undefined
): string | null {
	if (!taper || taper.afterDays < 0) return null;
	const regularStart = loadingEndDate(startDate, loading) ?? startDate;
	return shiftIsoDate(regularStart, taper.afterDays);
}

/** Is `date` on or after the taper phase's start? Once a taper phase starts it never turns back off —
 *  it IS the new maintenance dose from that point on — so unlike isLoadingPhaseOn there's no upper bound
 *  here; a protocol's own endDate (via isDueOn) is what eventually stops it being "due" at all. */
export function isTaperPhaseOn(
	startDate: string,
	loading: LoadingPhase | null | undefined,
	taper: TaperPhase | null | undefined,
	date: string
): boolean {
	const taperStart = taperStartDate(startDate, loading, taper);
	return taperStart != null && date >= taperStart;
}

/** The dose that actually applies on `date`: the loading dose while isLoadingPhaseOn, the taper dose
 *  once isTaperPhaseOn (the two can never overlap — a taper always starts at or after loadingEndDate),
 *  otherwise the protocol's own maintenance dose. */
export function effectiveDoseMcg(
	maintenanceDoseMcg: number,
	startDate: string,
	loading: LoadingPhase | null | undefined,
	date: string,
	taper?: TaperPhase | null
): number {
	if (isLoadingPhaseOn(startDate, loading, date)) return loading!.doseMcg;
	if (isTaperPhaseOn(startDate, loading, taper, date)) return taper!.doseMcg;
	return maintenanceDoseMcg;
}

/** The dose-shaping fields of a protocol — enough to know what it asks for on any date. Flat, matching
 *  the repository's Protocol type, so a decoded protocol can be passed straight in. */
export type ProtocolDoseFields = {
	doseMcg: number;
	startDate: string;
	loadingDoseMcg?: number | null;
	loadingDurationDays?: number | null;
	taperDoseMcg?: number | null;
	taperAfterDays?: number | null;
};

export function loadingOf(p: ProtocolDoseFields): LoadingPhase | null {
	return p.loadingDoseMcg != null && p.loadingDurationDays != null
		? { doseMcg: p.loadingDoseMcg, durationDays: p.loadingDurationDays }
		: null;
}

export function taperOf(p: ProtocolDoseFields): TaperPhase | null {
	return p.taperDoseMcg != null && p.taperAfterDays != null ? { doseMcg: p.taperDoseMcg, afterDays: p.taperAfterDays } : null;
}

/** The per-dose target on `date`, honouring loading and taper phases. This — not the protocol's base
 *  doseMcg — is what a logged dose on that date should be compared against. */
export function targetDoseOn(p: ProtocolDoseFields, date: string): number {
	return effectiveDoseMcg(p.doseMcg, p.startDate, loadingOf(p), date, taperOf(p));
}

export type DosePhase = 'loading' | 'regular' | 'taper';

export function phaseOn(p: ProtocolDoseFields, date: string): DosePhase {
	if (isLoadingPhaseOn(p.startDate, loadingOf(p), date)) return 'loading';
	if (isTaperPhaseOn(p.startDate, loadingOf(p), taperOf(p), date)) return 'taper';
	return 'regular';
}

export type UpcomingChange = {
	date: string;
	kind: 'loading_ends' | 'taper_starts' | 'cycle_off' | 'cycle_on' | 'ends';
	/** The per-dose target from that date on, when the change affects it. */
	doseMcg: number | null;
};

/** Schedule/dose changes coming up within `horizonDays` of `today` (exclusive of today), oldest first —
 *  "loading ends Thu, then 250 mcg", "cycle break starts in 5 days". Powers the hub timeline and the AI. */
export function upcomingChanges(p: ProtocolSchedule & ProtocolDoseFields, today: string, horizonDays = 60): UpcomingChange[] {
	const out: UpcomingChange[] = [];
	const horizon = shiftIsoDate(today, horizonDays);
	const inWindow = (d: string | null) => d != null && d > today && d <= horizon && (!p.endDate || d <= shiftIsoDate(p.endDate, 1));
	const loadEnd = loadingEndDate(p.startDate, loadingOf(p));
	if (inWindow(loadEnd)) out.push({ date: loadEnd!, kind: 'loading_ends', doseMcg: targetDoseOn(p, loadEnd!) });
	const taperStart = taperStartDate(p.startDate, loadingOf(p), taperOf(p));
	if (inWindow(taperStart)) out.push({ date: taperStart!, kind: 'taper_starts', doseMcg: taperOf(p)!.doseMcg });
	const cyc = cycleState(p, today);
	if (cyc.nextTransition && inWindow(cyc.nextTransition)) {
		out.push({ date: cyc.nextTransition, kind: cyc.phase === 'on' ? 'cycle_off' : 'cycle_on', doseMcg: null });
	}
	if (p.endDate && p.endDate >= today && p.endDate <= horizon) out.push({ date: p.endDate, kind: 'ends', doseMcg: null });
	return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/** The first date on or after `fromIso` with a dose scheduled, or null when there's none inside
 *  `horizonDays`. Null is also the honest answer for 'x_per_week', which sets a weekly target rather
 *  than specific days — isDueOn never fires for it, so there is no next date to count down to. */
export function nextDueDate(s: ProtocolSchedule, fromIso: string, horizonDays = 120): string | null {
	for (let i = 0; i <= horizonDays; i++) {
		const d = shiftIsoDate(fromIso, i);
		if (isDueOn(s, d)) return d;
	}
	return null;
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
	for (let i = 0; i <= span; i++) count += slotsOn(s, shiftIsoDate(fromIso, i));
	return count;
}
