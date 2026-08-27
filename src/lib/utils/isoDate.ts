/** Helpers for the 'YYYY-MM-DD' local-date strings used by meal_logs.date and workout_sessions.date. */

const ISO_RE = /^\d{4}-\d{2}-\d{2}$/;

/** True for a well-formed, real calendar date in 'YYYY-MM-DD' form (rejects e.g. 2026-02-30). */
export function isValidIsoDate(value: string): boolean {
	if (!ISO_RE.test(value)) return false;
	const [y, m, d] = value.split('-').map(Number);
	const dt = new Date(y, m - 1, d);
	return dt.getFullYear() === y && dt.getMonth() === m - 1 && dt.getDate() === d;
}

/** Returns the ISO date `days` away from `iso` (built at local noon to sidestep DST edges). */
export function shiftIsoDate(iso: string, days: number): string {
	const [y, m, d] = iso.split('-').map(Number);
	const dt = new Date(y, m - 1, d + days, 12);
	const yy = dt.getFullYear();
	const mm = String(dt.getMonth() + 1).padStart(2, '0');
	const dd = String(dt.getDate()).padStart(2, '0');
	return `${yy}-${mm}-${dd}`;
}

/** The Monday of the week containing `iso` (built at local noon, same DST-safe approach as shiftIsoDate).
 *  Used to key the weekly AI digest cache — one row per (user, isoWeekStart). */
export function isoWeekStart(iso: string): string {
	const [y, m, d] = iso.split('-').map(Number);
	const day = new Date(y, m - 1, d, 12).getDay(); // 0 = Sunday … 6 = Saturday
	const offset = day === 0 ? -6 : 1 - day; // shift back to Monday
	return shiftIsoDate(iso, offset);
}
