// The single source of peptide facts for the AI — both the dashboard recap (peptideInsights.ts) and the
// AI Coach's tools (tools.ts) read from here, and it's built from the same shared context/engine the
// dashboard and compound pages render (peptideContext + peptideAdherence + peptideIntake), so the AI
// can't be told something the screens disagree with.
//
// Why this exists: the AI used to get its own hand-rolled numbers, and they were wrong in ways that
// made it "wrong about what you've taken" — no today's date, only active protocols' doses, blends never
// split, "days of supply" that was really doses, logged loading doses shown as drift, stale caches.
// Everything here is precomputed and labelled so the model only has to phrase it, never derive it.

import { createHash } from 'node:crypto';
import type { PeptideContext } from '$lib/server/peptideContext';
import { adherenceFor, nameOf, todayFor, vialStatus } from '$lib/server/peptideContext';
import { mixFor } from '$lib/server/peptideViews';
import { toSchedule } from '$lib/server/repositories/peptideProtocols';
import { shiftIsoDate } from '$lib/utils/isoDate';
import { adherencePct } from '$lib/utils/peptideAdherence';
import { intakeTotals } from '$lib/utils/peptideIntake';
import {
	loadingEndDate,
	loadingOf,
	nextDueDate,
	phaseOn,
	scheduleLabel,
	taperOf,
	taperStartDate,
	targetDoseOn,
	upcomingChanges
} from '$lib/utils/peptideSchedule';
import { blendRatioSummary, CONTAINER_FORM_LABELS, effectLabel, formatDose, ROUTE_LABELS, SEVERITY_LABELS, siteLabel } from '$lib/utils/peptides';

/** Bump when the facts' shape or meaning changes, so cached summaries built from the old shape go stale. */
export const FACTS_VERSION = 2;

export function serverTimeZone(): string {
	try {
		return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
	} catch {
		return 'UTC';
	}
}

const mcg = (n: number) => Math.round(n * 1000) / 1000;
const routeName = (r: string | null) => (r ? (ROUTE_LABELS[r as keyof typeof ROUTE_LABELS] ?? r) : 'route not recorded');

/** The facts for the last `windowDays` days (inclusive of today). */
export function buildPeptideFacts(ctx: PeptideContext, opts: { windowDays?: number } = {}) {
	const windowDays = opts.windowDays ?? 30;
	const today = ctx.today;
	const from = shiftIsoDate(today, -(windowDays - 1));
	const inWindow = ctx.intake.filter((e) => e.date >= from && e.date <= today);

	// What was actually taken, per compound AND route (never summed across routes), blends split.
	const intake = intakeTotals(inWindow)
		.map((t) => {
			const entries = inWindow.filter((e) => e.peptideId === t.peptideId && e.route === t.route && (t.peptideId != null || e.name === t.name));
			const viaBlends = new Map<string, number>();
			const byDate = new Map<string, number>();
			for (const e of entries) {
				if (e.viaBlendName) viaBlends.set(e.viaBlendName, (viaBlends.get(e.viaBlendName) ?? 0) + e.mcg);
				byDate.set(e.date, (byDate.get(e.date) ?? 0) + e.mcg);
			}
			return {
				compound: t.name,
				route: routeName(t.route),
				totalMcg: t.totalMcg,
				total: formatDose(t.totalMcg),
				doses: t.doseCount,
				firstDate: t.firstDate,
				lastDate: t.lastDate,
				viaBlends: [...viaBlends].map(([blend, amount]) => ({ blend, mcg: mcg(amount) })),
				splitEstimated: t.estimated,
				byDate: [...byDate].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, amount]) => ({ date, mcg: mcg(amount) }))
			};
		})
		.sort((a, b) => b.lastDate.localeCompare(a.lastDate));

	// Blend doses as logged (the blend itself), so "you took 4 mg KLOW twice" can be said too.
	const blends = ctx.peptides
		.filter((p) => p.isBlend)
		.map((b) => {
			const doses = ctx.doses.filter((d) => d.peptideId === b.id && d.kind === 'dose' && d.date >= from);
			return {
				blend: b.name,
				mix: b.components ? blendRatioSummary(b.components) : null,
				dosesInWindow: doses.length,
				totalInWindow: formatDose(doses.reduce((s, d) => s + d.doseMcg, 0))
			};
		})
		.filter((b) => b.dosesInWindow > 0);

	const protocols = ctx.protocols
		.filter((p) => p.active || ctx.doses.some((d) => ctx.assigned.get(d.id) === p.id && d.date >= from))
		.map((p) => {
			const a = adherenceFor(ctx, p, from);
			const state = todayFor(ctx, p);
			const loading = loadingOf(p);
			const taper = taperOf(p);
			const mix = mixFor(ctx, p);
			const logged = ctx.doses
				.filter((d) => ctx.assigned.get(d.id) === p.id && d.date >= from && (d.kind === 'dose' || d.kind === 'skip'))
				.reverse() // oldest → newest
				.map((d) => ({
					date: d.date,
					time: d.time,
					kind: d.kind,
					doseMcg: d.kind === 'skip' ? null : d.doseMcg,
					targetMcgThatDay: targetDoseOn(p, d.date),
					phaseThatDay: phaseOn(p, d.date),
					matchesTarget: d.kind === 'dose' ? Math.abs(d.doseMcg - targetDoseOn(p, d.date)) < 0.5 : null
				}));
			const pendingToday = state.mode === 'slots' && state.pending > 0;
			return {
				compound: nameOf(ctx, p.peptideId),
				status: p.active ? 'active' : 'paused',
				schedule: scheduleLabel(toSchedule(p)),
				route: routeName(p.route),
				timeOfDay: p.timeOfDay,
				startDate: p.startDate,
				endDate: p.endDate,
				baseDoseMcg: p.doseMcg,
				targetTodayMcg: state.targetMcg,
				phaseToday: phaseOn(p, today),
				loadingPhase: loading ? { doseMcg: loading.doseMcg, from: p.startDate, until: shiftIsoDate(loadingEndDate(p.startDate, loading)!, -1) } : null,
				taperPhase: taper ? { doseMcg: taper.doseMcg, from: taperStartDate(p.startDate, loading, taper) } : null,
				blendMix: mix ? blendRatioSummary(mix) : null,
				today:
					state.mode === 'slots'
						? { scheduled: state.slots, taken: state.taken, skipped: state.skipped, stillDue: state.pending }
						: { weeklyTarget: state.target, takenThisWeek: state.taken, skippedThisWeek: state.skipped, remainingThisWeek: state.remaining },
				adherenceInWindow: { ...a.totals, percent: adherencePct(a.totals) },
				nextDue: p.active ? nextDueDate(toSchedule(p), pendingToday ? today : shiftIsoDate(today, 1)) : null,
				upcomingChanges: p.active ? upcomingChanges(p, today, 60) : [],
				loggedInWindow: logged
			};
		});

	const supply = ctx.vials
		.filter((v) => !v.depleted)
		.map((v) => {
			const s = vialStatus(ctx, v);
			return {
				compound: nameOf(ctx, v.peptideId),
				container:
					v.form === 'vial'
						? `${v.vialMg} mg vial${v.bacWaterMl ? ` reconstituted with ${v.bacWaterMl} mL` : ''}`
						: CONTAINER_FORM_LABELS[v.form],
				concentrationMcgPerMl: v.form === 'vial' && v.vialMg && v.bacWaterMl ? mcg((v.vialMg * 1000) / v.bacWaterMl) : null,
				remainingMcg: s.remainingMcg != null ? mcg(s.remainingMcg) : null,
				remaining: s.remainingMcg != null ? formatDose(s.remainingMcg) : null,
				dosesLeftAtCurrentTarget: s.unit === 'dose' ? s.dosesLeft : null,
				unitsLeft: s.unit !== 'dose' && s.dosesLeft != null ? `${s.dosesLeft} ${s.unit}` : null,
				// Days, from the actual schedule — NOT doses. Null when no active protocol draws on it.
				daysOfSupplyOnSchedule: s.projection?.daysLeft ?? null,
				runsOutOn: s.projection?.runsOutOn ?? null,
				lastsBeyondAYear: s.projection?.beyondHorizon ?? false,
				reconstitutedOn: v.reconstitutedAt,
				expiresOn: v.expiresAt,
				expiry: s.expiry
			};
		});

	// Recent side-effect check-ins (tags only — free-text notes never go into these facts).
	const effects = ctx.doses
		.filter((d) => d.kind === 'dose' && d.date >= from && d.effects.length > 0)
		.map((d) => ({
			date: d.date,
			compound: nameOf(ctx, d.peptideId),
			effects: d.effects.map((e) => `${effectLabel(e.tag)} (${SEVERITY_LABELS[e.severity].toLowerCase()})`)
		}));

	return {
		today,
		timezone: serverTimeZone(),
		window: { days: windowDays, from, to: today },
		notes: [
			'All amounts are micrograms (mcg) unless labelled; 1 mg = 1000 mcg.',
			'Blend doses are already split into their components in `intake` (e.g. KLOW → GHK-Cu, BPC-157, TB-500, KPV).',
			'Amounts on different routes are listed separately and must never be added together.',
			'Compare a logged dose with targetMcgThatDay (loading/taper aware), not baseDoseMcg.',
			'daysOfSupplyOnSchedule and runsOutOn already account for the schedule; dosesLeftAtCurrentTarget is a count of doses, not days.'
		],
		intake,
		blends,
		protocols,
		supply,
		sideEffects: effects
	};
}

export type PeptideFacts = ReturnType<typeof buildPeptideFacts>;

/** Stable hash of the facts (+ a caller-supplied prompt version) — a cached summary is current only while
 *  this matches. Includes `today`, so a summary naturally goes stale at midnight too. */
export function factsFingerprint(facts: PeptideFacts, promptVersion: string): string {
	return createHash('sha256')
		.update(JSON.stringify({ v: FACTS_VERSION, p: promptVersion, facts }))
		.digest('hex')
		.slice(0, 32);
}

/** The AI Coach's detailed dose log: every entry in a date range (optionally one compound — blends
 *  matched by name or by containing it), newest first, with split, route/site/units, notes and
 *  side-effect check-ins. Notes are included here by the user's explicit choice (the Coach is opt-in);
 *  the dashboard recap never gets them. */
export function doseLogForAi(ctx: PeptideContext, opts: { from: string; to: string; compound?: string | null; limit?: number }) {
	const q = opts.compound?.trim().toLowerCase() || null;
	const matchesCompound = (peptideId: number, doseId: number) => {
		if (!q) return true;
		if (nameOf(ctx, peptideId).toLowerCase().includes(q)) return true;
		return ctx.intake.some((e) => e.doseId === doseId && e.name.toLowerCase().includes(q));
	};
	const splitOf = new Map<number, { name: string; mcg: number }[]>();
	for (const e of ctx.intake) {
		if (e.viaBlendId == null) continue;
		const list = splitOf.get(e.doseId) ?? [];
		list.push({ name: e.name, mcg: e.mcg });
		splitOf.set(e.doseId, list);
	}
	const rows = ctx.doses
		.filter((d) => d.date >= opts.from && d.date <= opts.to && matchesCompound(d.peptideId, d.id))
		.slice(0, opts.limit ?? 200)
		.map((d) => {
			const vial = d.vialId != null ? ctx.vials.find((v) => v.id === d.vialId) : undefined;
			return {
				date: d.date,
				time: d.time,
				compound: nameOf(ctx, d.peptideId),
				kind: d.kind,
				doseMcg: d.kind === 'skip' ? null : d.doseMcg,
				dose: d.kind === 'skip' ? 'skipped' : formatDose(d.doseMcg),
				blendSplit: splitOf.get(d.id) ?? null,
				route: routeName(d.route),
				site: d.site ? siteLabel(d.site) : null,
				measured: d.measureCount != null && d.measureUnit ? `${d.measureCount} ${d.measureUnit}` : null,
				container: vial ? (vial.form === 'vial' ? `${vial.vialMg} mg vial in ${vial.bacWaterMl ?? '?'} mL` : CONTAINER_FORM_LABELS[vial.form]) : null,
				protocol: (() => {
					const pid = ctx.assigned.get(d.id);
					const p = pid != null ? ctx.protocols.find((x) => x.id === pid) : undefined;
					return p ? `${scheduleLabel(toSchedule(p))}${p.active ? '' : ' (paused)'}` : null;
				})(),
				sideEffects: d.effects.map((e) => `${effectLabel(e.tag)} (${SEVERITY_LABELS[e.severity].toLowerCase()})`),
				notes: d.notes
			};
		});
	return { from: opts.from, to: opts.to, compound: opts.compound ?? null, count: rows.length, entries: rows };
}
