// Serializable view-models built from a PeptideContext — the shapes the dashboard and the compound hub
// render. Kept here (not in each +page.server.ts) so both pages show a dose, a due row or a level the
// same way, and so both can mount the same LogDoseModal with the same data.

import {
	activeAmountMcg,
	splitBlendDose,
	type AdminRoute,
	type ApplicationSite,
	type BlendComponent,
	type BlendPortion,
	type DoseEffect,
	type DoseKind,
	type MeasureUnit
} from '$lib/utils/peptides';
import { isWithinActiveSpan, phaseOn, scheduleLabel, type DosePhase } from '$lib/utils/peptideSchedule';
import { adherencePct, calendarDays, sumTotals, type AdherenceTotals, type CalendarDay, type TodayState } from '$lib/utils/peptideAdherence';
import { intakeRoutes, levelDoses } from '$lib/utils/peptideIntake';
import { shiftIsoDate } from '$lib/utils/isoDate';
import type { Protocol } from '$lib/server/repositories/peptideProtocols';
import type { Dose } from '$lib/server/repositories/peptideDoses';
import { toSchedule } from '$lib/server/repositories/peptideProtocols';
import { adherenceFor, lastUsedByVial, nameOf, todayFor, type PeptideContext } from './peptideContext';

/** The blend mix a protocol doses with: its own override, else the blend compound's default. */
export function mixFor(ctx: PeptideContext, p: Protocol): BlendComponent[] | null {
	const compound = ctx.byId.get(p.peptideId);
	if (!compound?.isBlend) return null;
	return p.components?.length ? p.components : compound.components;
}

export type DueRow = {
	protocolId: number;
	peptideId: number;
	peptideName: string;
	isBlend: boolean;
	state: TodayState;
	/** Every slot for today (or this week's target) is taken or skipped. */
	done: boolean;
	phase: DosePhase;
	route: AdminRoute | null;
	timeOfDay: string | null;
	schedule: string;
	/** For a blend: what today's target dose splits into. */
	split: BlendPortion[] | null;
};

/** Active protocols with something scheduled today — or, for a flexible weekly target, any day in its
 *  active span — with today's progress. */
export function dueRows(ctx: PeptideContext, protocols: Protocol[] = ctx.active): DueRow[] {
	const rows: DueRow[] = [];
	for (const p of protocols) {
		if (!p.active) continue;
		const state = todayFor(ctx, p);
		if (state.mode === 'slots' && state.slots === 0) continue;
		if (state.mode === 'weekly' && (!isWithinActiveSpan(toSchedule(p), ctx.today) || state.target === 0)) continue;
		const mix = mixFor(ctx, p);
		rows.push({
			protocolId: p.id,
			peptideId: p.peptideId,
			peptideName: nameOf(ctx, p.peptideId),
			isBlend: mix != null,
			state,
			done: state.mode === 'slots' ? state.pending === 0 : state.remaining === 0,
			phase: phaseOn(p, ctx.today),
			route: p.route,
			timeOfDay: p.timeOfDay,
			schedule: scheduleLabel(toSchedule(p)),
			split: mix ? splitBlendDose(state.targetMcg, mix) : null
		});
	}
	// Still-to-do first, then by time of day as typed ("AM" < "PM" and "08:00" < "20:00" both sort fine).
	return rows.sort((a, b) => Number(a.done) - Number(b.done) || (a.timeOfDay ?? '').localeCompare(b.timeOfDay ?? ''));
}

export type DoseRow = {
	id: number;
	peptideId: number;
	peptideName: string;
	protocolId: number | null;
	vialId: number | null;
	date: string;
	time: string | null;
	doseMcg: number;
	site: ApplicationSite | null;
	route: AdminRoute | null;
	measureCount: number | null;
	measureUnit: MeasureUnit | null;
	kind: DoseKind;
	notes: string | null;
	effects: DoseEffect[];
	/** For a blend dose: its components' share (recorded, or estimated for pre-split rows). */
	split: { peptideId: number | null; name: string; mcg: number }[] | null;
	splitEstimated: boolean;
};

export function doseRows(ctx: PeptideContext, doses: Dose[]): DoseRow[] {
	const byDose = new Map<number, typeof ctx.intake>();
	for (const e of ctx.intake) {
		if (e.viaBlendId == null) continue;
		const list = byDose.get(e.doseId) ?? [];
		list.push(e);
		byDose.set(e.doseId, list);
	}
	return doses.map((d) => {
		const parts = byDose.get(d.id) ?? null;
		return {
			id: d.id,
			peptideId: d.peptideId,
			peptideName: nameOf(ctx, d.peptideId),
			protocolId: d.protocolId,
			vialId: d.vialId,
			date: d.date,
			time: d.time,
			doseMcg: d.doseMcg,
			site: d.site,
			route: d.route,
			measureCount: d.measureCount,
			measureUnit: d.measureUnit,
			kind: d.kind,
			notes: d.notes,
			effects: d.effects,
			split: parts ? parts.map((e) => ({ peptideId: e.peptideId, name: e.name, mcg: e.mcg })) : null,
			splitEstimated: parts?.some((e) => e.estimated) ?? false
		};
	});
}

export type ActiveLevelRow = {
	peptideId: number;
	peptideName: string;
	route: AdminRoute | null;
	activeMcg: number;
	halfLifeHours: number;
	lastDoseDate: string | null;
	/** Some of this level came from blend doses (e.g. GHK-Cu via KLOW). */
	viaBlend: boolean;
};

/** "Active in body" estimates for every compound with a half-life, per route (never summed across
 *  routes), including what arrived via blends. */
export function activeLevelRows(ctx: PeptideContext, now: Date = new Date()): ActiveLevelRow[] {
	const rows: ActiveLevelRow[] = [];
	for (const p of ctx.peptides) {
		if (p.halfLifeHours == null || p.isBlend) continue;
		for (const route of intakeRoutes(ctx.intake, p.id)) {
			const series = levelDoses(ctx.intake, p.id, route);
			const activeMcg = activeAmountMcg(series, p.halfLifeHours, now);
			if (activeMcg <= 0.01) continue;
			const mine = ctx.intake.filter((e) => e.peptideId === p.id && e.route === route);
			rows.push({
				peptideId: p.id,
				peptideName: p.name,
				route,
				activeMcg,
				halfLifeHours: p.halfLifeHours,
				lastDoseDate: mine.reduce<string | null>((max, e) => (max == null || e.date > max ? e.date : max), null),
				viaBlend: mine.some((e) => e.viaBlendId != null)
			});
		}
	}
	return rows.sort((a, b) => b.activeMcg - a.activeMcg);
}

export type AdherenceSummary = {
	pct: number | null;
	totals: AdherenceTotals;
	windowDays: number;
	calendar: CalendarDay[];
};

/** Adherence over the last `windowDays` across `protocols` (default: all active), plus a calendar of the
 *  last `calendarDays` days. */
export function adherenceSummary(
	ctx: PeptideContext,
	opts: { protocols?: Protocol[]; windowDays?: number; calendarDays?: number } = {}
): AdherenceSummary {
	const protocols = opts.protocols ?? ctx.active;
	const windowDays = opts.windowDays ?? 30;
	const calDays = opts.calendarDays ?? 70;
	const windowFrom = shiftIsoDate(ctx.today, -(windowDays - 1));
	const calFrom = shiftIsoDate(ctx.today, -(calDays - 1));
	const totals = sumTotals(protocols.map((p) => adherenceFor(ctx, p, windowFrom).totals));
	const perProtocolCal = protocols.map((p) => adherenceFor(ctx, p, calFrom));
	const ids = new Set(protocols.map((p) => p.peptideId));
	const doses = opts.protocols ? ctx.doses.filter((d) => ids.has(d.peptideId)) : ctx.doses;
	return { pct: adherencePct(totals), totals, windowDays, calendar: calendarDays(perProtocolCal, doses, calFrom, ctx.today) };
}

/** Everything LogDoseModal needs to prefill smartly: compounds (inactive included, for editing old
 *  doses), active protocols with today's target and mix, and every container with when it was last used. */
export function logModalData(ctx: PeptideContext) {
	const lastUsed = lastUsedByVial(ctx);
	return {
		compounds: ctx.peptides.map((p) => ({
			id: p.id,
			name: p.name,
			category: p.category,
			active: p.active,
			isBlend: p.isBlend,
			components: p.components
		})),
		protocols: ctx.active.map((p) => ({
			id: p.id,
			peptideId: p.peptideId,
			label: scheduleLabel(toSchedule(p)),
			route: p.route,
			timeOfDay: p.timeOfDay,
			rotateSites: p.rotateSites,
			targetMcg: todayFor(ctx, p).targetMcg,
			mix: mixFor(ctx, p)
		})),
		vials: ctx.vials.map((v) => ({
			id: v.id,
			peptideId: v.peptideId,
			form: v.form,
			vialMg: v.vialMg,
			bacWaterMl: v.bacWaterMl,
			concentrationMgMl: v.concentrationMgMl,
			percentWv: v.percentWv,
			actuationVolumeUl: v.actuationVolumeUl,
			primingActuations: v.primingActuations,
			unitCount: v.unitCount,
			unitMassMcg: v.unitMassMcg,
			depleted: v.depleted,
			expiresAt: v.expiresAt,
			lastUsed: lastUsed.get(v.id) ?? null
		}))
	};
}

export type LogModalData = ReturnType<typeof logModalData>;
