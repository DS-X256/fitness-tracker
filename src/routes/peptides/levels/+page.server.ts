import { fieldEncryptionAvailable } from '$lib/server/crypto/fieldCrypto';
import { listPeptides } from '$lib/server/repositories/peptides';
import { listProtocols, toSchedule } from '$lib/server/repositories/peptideProtocols';
import { dosesOnDate, listDoses } from '$lib/server/repositories/peptideDoses';
import { todayIso } from '$lib/utils/todayIso';
import { shiftIsoDate } from '$lib/utils/isoDate';
import { isDueOn, nextDueDate } from '$lib/utils/peptideSchedule';
import type { PageServerLoad } from './$types';

// Everything the level curve needs, per compound that has a half-life on file. The curve itself is
// computed in the browser (levelSeries) so switching the range doesn't cost a round trip — the server's
// job is just to hand over the dose history and the schedule context.

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const today = todayIso();
	if (!fieldEncryptionAvailable()) {
		return { encryptionReady: false as const, today, nowMs: Date.now(), compounds: [] };
	}

	const [peptides, protocols, doses, todaysDoses] = await Promise.all([
		// Inactive compounds included on purpose: after stopping something, watching it wash out is
		// exactly when this screen is most useful.
		listPeptides(userId, { includeInactive: true }),
		listProtocols(userId, { activeOnly: true }),
		listDoses(userId),
		dosesOnDate(userId, today)
	]);

	const loggedToday = new Set(todaysDoses.filter((d) => d.kind === 'dose').map((d) => d.peptideId));

	const compounds = peptides
		.filter((p) => p.halfLifeHours != null)
		.map((p) => {
			// listDoses is newest-first; the series wants oldest-first, and [0] stays the latest dose.
			const own = doses.filter((d) => d.peptideId === p.id && d.kind === 'dose');
			const proto = protocols.find((pr) => pr.peptideId === p.id) ?? null;

			let nextDue: string | null = null;
			if (proto) {
				const schedule = toSchedule(proto);
				// A dose due today but not yet logged is the next one; otherwise look from tomorrow.
				const from = isDueOn(schedule, today) && !loggedToday.has(p.id) ? today : shiftIsoDate(today, 1);
				nextDue = nextDueDate(schedule, from);
			}

			return {
				id: p.id,
				name: p.name,
				active: p.active,
				halfLifeHours: p.halfLifeHours!,
				doses: own.map((d) => ({ date: d.date, doseMcg: d.doseMcg })).reverse(),
				doseCount: own.length,
				lastDoseDate: own[0]?.date ?? null,
				lastDoseMcg: own[0]?.doseMcg ?? null,
				nextDue,
				// 'x_per_week' sets a weekly target rather than specific days, so there's no date to count
				// down to — the UI says so instead of showing an empty countdown.
				flexibleSchedule: proto?.frequency === 'x_per_week'
			};
		})
		.filter((c) => c.doseCount > 0);

	return { encryptionReady: true as const, today, nowMs: Date.now(), compounds };
};
