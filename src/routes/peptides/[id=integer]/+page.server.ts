import { error } from '@sveltejs/kit';
import { fieldEncryptionAvailable } from '$lib/server/crypto/fieldCrypto';
import { adherenceFor, loadPeptideContext, todayFor, vialStatus } from '$lib/server/peptideContext';
import { adherenceSummary, doseRows, dueRows, logModalData, mixFor } from '$lib/server/peptideViews';
import { recentSites } from '$lib/server/repositories/peptideDoses';
import { listPhotos } from '$lib/server/repositories/peptidePhotos';
import { toSchedule } from '$lib/server/repositories/peptideProtocols';
import { adherencePct } from '$lib/utils/peptideAdherence';
import { intakeRoutes, intakeTotals, levelDoses } from '$lib/utils/peptideIntake';
import { shiftIsoDate } from '$lib/utils/isoDate';
import { nextDueDate, phaseOn, scheduleLabel, upcomingChanges } from '$lib/utils/peptideSchedule';
import type { EffectSeverity, EffectTag } from '$lib/utils/peptides';
import type { PageServerLoad } from './$types';

// The compound hub: one page that ties together everything about a compound — its protocols and where
// they are in their phases, the containers holding it and how long they'll last, every dose (its own,
// plus its share of any blend doses, e.g. GHK-Cu via KLOW), side effects, the level curve and photos.
// Every number comes from the same shared context/engine the dashboard and the AI use.

const HISTORY_LIMIT = 60;
const EFFECTS_WINDOW_DAYS = 60;

export const load: PageServerLoad = async ({ locals, params }) => {
	const userId = locals.user!.id;
	if (!fieldEncryptionAvailable()) throw error(404, 'Not found');
	const id = Number(params.id);
	const [ctx, siteHistory, photos] = await Promise.all([
		loadPeptideContext(userId),
		recentSites(userId, 20),
		listPhotos(userId, { peptideId: id })
	]);
	const compound = ctx.byId.get(id);
	if (!compound) throw error(404, 'Compound not found');
	const today = ctx.today;

	// Blends this compound is a component of.
	const partOf = ctx.peptides
		.filter((b) => b.isBlend && (b.components ?? []).some((c) => c.peptideId === id))
		.map((b) => ({ id: b.id, name: b.name, active: b.active }));

	const protocols = ctx.protocols
		.filter((p) => p.peptideId === id)
		.map((p) => {
			const a = adherenceFor(ctx, p, shiftIsoDate(today, -29));
			const state = todayFor(ctx, p);
			const pendingToday = state.mode === 'slots' && state.pending > 0;
			return {
				...p,
				schedule: scheduleLabel(toSchedule(p)),
				targetMcg: state.targetMcg,
				phase: phaseOn(p, today),
				nextDue: p.active ? nextDueDate(toSchedule(p), pendingToday ? today : shiftIsoDate(today, 1)) : null,
				upcoming: p.active ? upcomingChanges(p, today, 90) : [],
				adherence: { ...a.totals, pct: adherencePct(a.totals) },
				mix: mixFor(ctx, p)
			};
		})
		.sort((a, b) => Number(b.active) - Number(a.active));

	const vials = ctx.vials
		.filter((v) => v.peptideId === id)
		.map((v) => ({ ...v, status: vialStatus(ctx, v) }))
		.sort((a, b) => Number(a.depleted) - Number(b.depleted) || b.id - a.id);

	// History: this compound's own doses, plus blend doses it was part of (with its share).
	const mine = ctx.intake.filter((e) => e.peptideId === id);
	const viaShare = new Map<number, number>();
	for (const e of mine) if (e.viaBlendId != null) viaShare.set(e.doseId, (viaShare.get(e.doseId) ?? 0) + e.mcg);
	const historyDoses = ctx.doses.filter((d) => d.peptideId === id || viaShare.has(d.id)).slice(0, HISTORY_LIMIT);

	// A blend's intake is attributed to its components, so its own totals come from its dose rows.
	const own = compound.isBlend
		? ctx.doses
				.filter((d) => d.peptideId === id && d.kind === 'dose')
				.map((d) => ({ doseId: d.id, date: d.date, time: d.time, route: d.route, peptideId: id, name: compound.name, mcg: d.doseMcg, viaBlendId: null, viaBlendName: null, estimated: false }))
		: mine;
	const since30 = shiftIsoDate(today, -29);
	const totals30 = intakeTotals(own.filter((e) => e.date >= since30));
	const totalsAll = intakeTotals(own);

	// Side effects reported on doses that contained this compound, recent window.
	const sinceEffects = shiftIsoDate(today, -(EFFECTS_WINDOW_DAYS - 1));
	const effectCounts = new Map<EffectTag, { count: number; max: EffectSeverity }>();
	let checkedIn = 0;
	for (const d of ctx.doses) {
		if (d.date < sinceEffects || d.kind !== 'dose') continue;
		if (d.peptideId !== id && !viaShare.has(d.id)) continue;
		if (d.effects.length > 0) checkedIn++;
		for (const e of d.effects) {
			const cur = effectCounts.get(e.tag);
			effectCounts.set(e.tag, { count: (cur?.count ?? 0) + 1, max: Math.max(cur?.max ?? 1, e.severity) as EffectSeverity });
		}
	}
	const dosesInEffectsWindow = ctx.doses.filter(
		(d) => d.kind === 'dose' && d.date >= sinceEffects && (d.peptideId === id || viaShare.has(d.id))
	).length;

	// Level curves (per route) when a half-life is on file.
	const levels =
		compound.halfLifeHours != null && !compound.isBlend
			? intakeRoutes(ctx.intake, id).map((route) => ({
					route,
					doses: levelDoses(ctx.intake, id, route).reverse()
				}))
			: [];

	return {
		today,
		nowMs: Date.now(),
		compound: {
			id: compound.id,
			name: compound.name,
			category: compound.category,
			active: compound.active,
			isBlend: compound.isBlend,
			components: compound.components,
			vialMg: compound.vialMg,
			halfLifeHours: compound.halfLifeHours,
			notes: compound.notes,
			doseCount: compound.doseCount
		},
		partOf,
		due: dueRows(ctx).filter((r) => r.peptideId === id),
		protocols,
		adherence: adherenceSummary(ctx, { protocols: ctx.protocols.filter((p) => p.peptideId === id && p.active), calendarDays: 42 }),
		vials,
		history: doseRows(ctx, historyDoses),
		viaShare: Object.fromEntries(viaShare),
		totals30,
		totalsAll,
		effects: {
			windowDays: EFFECTS_WINDOW_DAYS,
			doses: dosesInEffectsWindow,
			checkedIn,
			tags: [...effectCounts].map(([tag, v]) => ({ tag, ...v })).sort((a, b) => b.count - a.count)
		},
		levels,
		photos: photos.slice(0, 6),
		photoCount: photos.length,
		// For the modals mounted on this page.
		compounds: ctx.peptides,
		modal: logModalData(ctx),
		siteHistory
	};
};
