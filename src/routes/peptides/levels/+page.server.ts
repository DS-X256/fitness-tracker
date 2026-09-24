import { fieldEncryptionAvailable } from '$lib/server/crypto/fieldCrypto';
import { loadPeptideContext, todayFor } from '$lib/server/peptideContext';
import { mixFor } from '$lib/server/peptideViews';
import { toSchedule } from '$lib/server/repositories/peptideProtocols';
import { todayIso } from '$lib/utils/todayIso';
import { shiftIsoDate } from '$lib/utils/isoDate';
import { nextDueDate } from '$lib/utils/peptideSchedule';
import { intakeRoutes, levelDoses } from '$lib/utils/peptideIntake';
import { ROUTE_LABELS, suggestHalfLifeHours } from '$lib/utils/peptides';
import type { PageServerLoad } from './$types';

// Everything the level curve needs, per compound (and per route — amounts are never summed across
// routes) that has a half-life on file. Intake comes from the shared blend-expanded view, so a component
// like GHK-Cu gets its curve from KLOW doses too. The curve itself is computed in the browser
// (levelSeries) so switching the range doesn't cost a round trip.

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	const today = todayIso();
	if (!fieldEncryptionAvailable()) {
		return { encryptionReady: false as const, today, nowMs: Date.now(), compounds: [], missingHalfLife: [] };
	}

	const ctx = await loadPeptideContext(userId, today);

	const compounds = ctx.peptides
		// Inactive compounds included on purpose: after stopping something, watching it wash out is exactly
		// when this screen is most useful. Blends themselves have no half-life — their components do.
		.filter((p) => p.halfLifeHours != null && !p.isBlend)
		.flatMap((p) => {
			const routes = intakeRoutes(ctx.intake, p.id);
			// The protocol that feeds this compound: its own, else a blend protocol whose mix contains it.
			const proto =
				ctx.active.find((pr) => pr.peptideId === p.id) ??
				ctx.active.find((pr) => (mixFor(ctx, pr) ?? []).some((c) => c.peptideId === p.id)) ??
				null;
			let nextDue: string | null = null;
			if (proto) {
				const state = todayFor(ctx, proto);
				const pendingToday = state.mode === 'slots' && state.pending > 0;
				nextDue = nextDueDate(toSchedule(proto), pendingToday ? today : shiftIsoDate(today, 1));
			}
			return routes.map((route) => {
				// levelDoses is in log order (newest first); the series wants oldest-first, [0] = latest dose.
				const own = ctx.intake.filter((e) => e.peptideId === p.id && e.route === route);
				return {
					key: `${p.id}|${route ?? ''}`,
					id: p.id,
					name: routes.length > 1 && route ? `${p.name} · ${ROUTE_LABELS[route]}` : p.name,
					active: p.active,
					halfLifeHours: p.halfLifeHours!,
					doses: levelDoses(ctx.intake, p.id, route).reverse(),
					doseCount: own.length,
					lastDoseDate: own[0]?.date ?? null,
					lastDoseMcg: own[0]?.mcg ?? null,
					viaBlend: own.some((e) => e.viaBlendId != null),
					nextDue,
					// 'x_per_week' sets a weekly target rather than specific days, so there's no date to count
					// down to — the UI says so instead of showing an empty countdown.
					flexibleSchedule: proto?.frequency === 'x_per_week'
				};
			});
		})
		.filter((c) => c.doseCount > 0);

	// Compounds you've actually taken (directly or via a blend) that can't be charted for lack of a
	// half-life — listed with a one-tap fix instead of silently missing from this screen.
	const missingHalfLife = ctx.peptides
		.filter((p) => !p.isBlend && p.halfLifeHours == null && ctx.intake.some((e) => e.peptideId === p.id))
		.map((p) => ({ id: p.id, name: p.name, standardHalfLifeHours: suggestHalfLifeHours(p.name) }));

	return { encryptionReady: true as const, today, nowMs: Date.now(), compounds, missingHalfLife };
};
