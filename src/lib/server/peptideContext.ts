// Everything a peptide screen (or the AI) needs about one user, loaded and decrypted ONCE, plus the few
// derived views every consumer shares: dose→protocol assignment, blend-expanded intake, per-container
// supply. The dashboard, the compound hub, the levels page, the AI summary and the AI Coach's tools all
// start from loadPeptideContext(), so "what did I take / am I on track / how long will this vial last"
// has exactly one answer app-wide. Still userId-scoped end to end — it only calls the scoped repositories.

import { listPeptides, type PeptideWithStats } from '$lib/server/repositories/peptides';
import { listProtocols, type Protocol } from '$lib/server/repositories/peptideProtocols';
import { listVials, type VialWithUsage } from '$lib/server/repositories/peptideVials';
import { listDoses, mcgConsumedByVial, type Dose } from '$lib/server/repositories/peptideDoses';
import { todayIso } from '$lib/utils/todayIso';
import { daysBetween, targetDoseOn } from '$lib/utils/peptideSchedule';
import { assignDoses, protocolAdherence, todayState, type ProtocolAdherence, type TodayState } from '$lib/utils/peptideAdherence';
import { dosesCovered, projectRunout, type RunoutProjection } from '$lib/utils/peptideSupply';
import { expandIntake, type IntakeEntry } from '$lib/utils/peptideIntake';
import { actuationsRemaining, containerConcentrationMgMl, containerTotalMcg, mcgPerActuation } from '$lib/utils/delivery';
import { containerFormForRoute, measureUnitForContainerForm, pickContainer, type MeasureUnit } from '$lib/utils/peptides';

export const EXPIRY_SOON_DAYS = 7;

export type PeptideContext = {
	userId: number;
	today: string;
	/** Every compound, inactive included (history and via-blend intake still reference them). */
	peptides: PeptideWithStats[];
	byId: Map<number, PeptideWithStats>;
	/** Every protocol, paused included. */
	protocols: Protocol[];
	active: Protocol[];
	/** Every container, depleted included. */
	vials: VialWithUsage[];
	/** The whole dose log, newest first. */
	doses: Dose[];
	consumedByVial: Map<number, number>;
	/** doseId → protocolId it counts toward (null = none). */
	assigned: Map<number, number | null>;
	/** Blend-expanded intake (real doses only). */
	intake: IntakeEntry[];
};

export async function loadPeptideContext(userId: number, today: string = todayIso()): Promise<PeptideContext> {
	const [peptides, protocols, vials, doses, consumedByVial] = await Promise.all([
		listPeptides(userId, { includeInactive: true }),
		listProtocols(userId),
		listVials(userId, { includeDepleted: true }),
		listDoses(userId),
		mcgConsumedByVial(userId)
	]);
	const byId = new Map(peptides.map((p) => [p.id, p]));
	const active = protocols.filter((p) => p.active);
	const assigned = assignDoses(protocols, doses, (p) => (p as Protocol).active);
	const intake = expandIntake(
		doses,
		peptides.map((p) => ({ id: p.id, name: p.name, isBlend: p.isBlend, components: p.components }))
	);
	return { userId, today, peptides, byId, protocols, active, vials, doses, consumedByVial, assigned, intake };
}

export function nameOf(ctx: PeptideContext, peptideId: number): string {
	return ctx.byId.get(peptideId)?.name ?? 'Unknown';
}

/** The doses/skips assignDoses() gave to one protocol. */
export function dosesForProtocol(ctx: PeptideContext, protocolId: number): Dose[] {
	return ctx.doses.filter((d) => ctx.assigned.get(d.id) === protocolId);
}

export function adherenceFor(ctx: PeptideContext, p: Protocol, from: string, to: string = ctx.today): ProtocolAdherence {
	return protocolAdherence(p, dosesForProtocol(ctx, p.id), from, to, ctx.today);
}

export function todayFor(ctx: PeptideContext, p: Protocol): TodayState {
	return todayState(p, dosesForProtocol(ctx, p.id), ctx.today);
}

/** Active protocols that draw from a container: same compound, and a route that fits the container's form
 *  (a subq protocol draws from the vial, not the nasal spray of the same compound). */
export function protocolsForVial(ctx: PeptideContext, v: VialWithUsage): Protocol[] {
	return ctx.active.filter((p) => p.peptideId === v.peptideId && (p.route == null || containerFormForRoute(p.route) === v.form));
}

export type VialStatus = {
	id: number;
	peptideId: number;
	totalMcg: number | null;
	remainingMcg: number | null;
	/** Doses (or sprays/patches/capsules — see `unit`) the remaining amount covers at the next target. */
	dosesLeft: number | null;
	unit: MeasureUnit | 'dose';
	/** Schedule-aware projection (null when no protocol draws from it or the amount is unknown). */
	projection: RunoutProjection | null;
	expiry: 'expired' | 'soon' | null;
	expiresInDays: number | null;
	low: boolean;
};

/** Remaining supply for one container, projected on the user's own schedule. Replaces the old "remaining ÷
 *  per-dose = days" math and the row-count "doses left" estimate. */
export function vialStatus(ctx: PeptideContext, v: VialWithUsage): VialStatus {
	const totalMcg = containerTotalMcg(v);
	const remainingMcg = totalMcg != null ? Math.max(0, totalMcg - (ctx.consumedByVial.get(v.id) ?? 0)) : null;
	const protos = protocolsForVial(ctx, v);
	const nextTarget = protos.length > 0 ? targetDoseOn(protos[0], ctx.today) : null;

	let dosesLeft: number | null = null;
	let unit: VialStatus['unit'] = 'dose';
	if (remainingMcg != null) {
		if ((v.form === 'nasal_spray' || v.form === 'serum') && v.actuationVolumeUl) {
			const conc = containerConcentrationMgMl(v);
			const mpa = conc != null ? mcgPerActuation(conc, v.actuationVolumeUl) : null;
			if (mpa != null && mpa > 0) {
				dosesLeft = actuationsRemaining(remainingMcg, mpa);
				unit = measureUnitForContainerForm(v.form);
			}
		} else if ((v.form === 'capsules' || v.form === 'patches') && v.unitMassMcg) {
			dosesLeft = Math.floor(remainingMcg / v.unitMassMcg + 1e-9);
			unit = measureUnitForContainerForm(v.form);
		} else if (nextTarget != null) {
			dosesLeft = dosesCovered(remainingMcg, nextTarget);
		}
	}

	let projection: RunoutProjection | null = null;
	if (remainingMcg != null && protos.length > 0 && !v.depleted) {
		const pending = protos.reduce((sum, p) => {
			const t = todayFor(ctx, p);
			return sum + (t.mode === 'slots' ? t.pending : 0);
		}, 0);
		projection = projectRunout(remainingMcg, protos, ctx.today, { pendingTodaySlots: pending });
	}

	let expiry: VialStatus['expiry'] = null;
	let expiresInDays: number | null = null;
	if (v.expiresAt) {
		expiresInDays = daysBetween(ctx.today, v.expiresAt);
		if (v.expiresAt < ctx.today) expiry = 'expired';
		else if (expiresInDays <= EXPIRY_SOON_DAYS) expiry = 'soon';
	}
	const low =
		(projection?.daysLeft != null && projection.daysLeft <= 7) || (dosesLeft != null && unit === 'dose' && dosesLeft <= 3);
	return { id: v.id, peptideId: v.peptideId, totalMcg, remainingMcg, dosesLeft, unit, projection, expiry, expiresInDays, low };
}

/** When each container was last drawn from ("date|createdAt", sortable) — feeds pickContainer(). */
export function lastUsedByVial(ctx: PeptideContext): Map<number, string> {
	const lastUsed = new Map<number, string>();
	for (const d of ctx.doses) {
		if (d.vialId != null && !lastUsed.has(d.vialId)) lastUsed.set(d.vialId, `${d.date}|${d.createdAt.toISOString()}`);
	}
	return lastUsed;
}

/** Best container for a dose of `peptideId` by `route` — see pickContainer(). */
export function bestContainer(ctx: PeptideContext, peptideId: number, route: Protocol['route']): VialWithUsage | null {
	const lastUsed = lastUsedByVial(ctx);
	return pickContainer(
		ctx.vials.map((v) => ({ ...v, lastUsed: lastUsed.get(v.id) ?? null })),
		peptideId,
		route,
		ctx.today
	);
}
