/** Today's date as 'YYYY-MM-DD' in the server's local timezone — the same convention
 *  workout_sessions.date and meal_logs.date use. */
export function todayIso(): string {
	const now = new Date();
	const y = now.getFullYear();
	const m = String(now.getMonth() + 1).padStart(2, '0');
	const d = String(now.getDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

/** The current local time as 'HH:MM' — the time-of-day companion to todayIso(). */
export function nowHm(): string {
	const now = new Date();
	return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}`;
}
