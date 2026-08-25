import { db } from '$lib/server/db';
import { peptideDoses } from '$lib/server/db/schema';
import { and, asc, desc, eq, gte, isNotNull, lte } from 'drizzle-orm';
import { decryptJson, encryptJson } from '$lib/server/crypto/fieldCrypto';
import { isValidIsoDate } from '$lib/utils/isoDate';
import {
	isAdminRoute,
	isApplicationSite,
	isDoseKind,
	isMeasureUnit,
	type AdminRoute,
	type ApplicationSite,
	type DoseKind,
	type MeasureUnit
} from '$lib/utils/peptides';

// The dose log (the "actuals"). Dose/site/route/notes are encrypted in `enc`; date + FK ids are
// cleartext, which is what lets the calendar and per-peptide adherence run without bulk-decrypting most
// of a row's content. `kind` is the one field that DOES need decrypting for those aggregates (below),
// because a priming actuation or a patch removal must never count as an adherent dose.

const aad = (userId: number) => `${userId}:peptide_doses`;

type DoseEnc = {
	doseMcg: number;
	site: ApplicationSite | null;
	route: AdminRoute | null;
	time: string | null;
	/** What the user actually measured out (e.g. 2 sprays), alongside the canonical doseMcg. */
	measureCount: number | null;
	measureUnit: MeasureUnit | null;
	/** 'prime' = a priming actuation, not an actual dose — excluded from adherence (see dateCounts /
	 *  loggedDatesForPeptide below) but still counts against the container's remaining supply. */
	kind: DoseKind;
	notes: string | null;
	/** Legacy key from before measureCount/measureUnit existed — syringe units shown at log time.
	 *  Never written by current code; only read as a decode fallback (see decode()). */
	unitsShown?: number | null;
};

export type Dose = {
	id: number;
	peptideId: number;
	protocolId: number | null;
	vialId: number | null;
	date: string;
	createdAt: Date;
} & Omit<DoseEnc, 'unitsShown'>;

export type DoseInput = {
	peptideId: number;
	protocolId?: number | null;
	vialId?: number | null;
	date: string;
	doseMcg: number;
	site?: ApplicationSite | null;
	route?: AdminRoute | null;
	time?: string | null;
	measureCount?: number | null;
	measureUnit?: MeasureUnit | null;
	kind?: DoseKind;
	notes?: string | null;
};

function decode(row: typeof peptideDoses.$inferSelect): Dose {
	const enc = decryptJson<DoseEnc>(row.enc, aad(row.userId));
	return {
		id: row.id,
		peptideId: row.peptideId,
		protocolId: row.protocolId,
		vialId: row.vialId,
		date: row.date,
		createdAt: row.createdAt,
		doseMcg: enc.doseMcg,
		site: enc.site ?? null,
		route: enc.route ?? null,
		time: enc.time ?? null,
		notes: enc.notes ?? null,
		// Backward compat: rows written before multi-route support have none of these three keys.
		measureUnit: enc.measureUnit ?? 'unit',
		measureCount: enc.measureCount ?? enc.unitsShown ?? null,
		kind: enc.kind ?? 'dose'
	};
}

function sanitize(input: DoseInput): DoseEnc {
	if (!Number.isFinite(input.doseMcg) || input.doseMcg <= 0 || input.doseMcg > 100_000) {
		throw new Error('Dose (mcg) is out of range');
	}
	const measureCount =
		input.measureCount != null && Number.isFinite(input.measureCount) ? input.measureCount : null;
	return {
		doseMcg: Math.round(input.doseMcg * 1000) / 1000,
		// Broad validators (any application site/route), not the injection-only ones — the injection-only
		// guards used here previously silently dropped every non-injection site/route on write.
		site: isApplicationSite(input.site) ? input.site : null,
		route: isAdminRoute(input.route) ? input.route : null,
		time: input.time?.trim() || null,
		measureCount,
		measureUnit: measureCount != null && isMeasureUnit(input.measureUnit) ? input.measureUnit : null,
		kind: isDoseKind(input.kind) ? input.kind : 'dose',
		notes: input.notes?.trim() || null
	};
}

export async function logDose(userId: number, input: DoseInput): Promise<Dose> {
	if (!isValidIsoDate(input.date)) throw new Error('Invalid date');
	const enc = sanitize(input);
	const [row] = await db
		.insert(peptideDoses)
		.values({
			userId,
			peptideId: input.peptideId,
			protocolId: input.protocolId ?? null,
			vialId: input.vialId ?? null,
			date: input.date,
			enc: encryptJson(enc, aad(userId)),
			createdAt: new Date()
		})
		.returning();
	return decode(row);
}

/** Edits an already-logged dose in place (fix a wrong dose/time/site/date after the fact) — unlike
 *  peptideProtocols, doses had no update path until this; a logged dose is otherwise immutable
 *  (log-then-delete-and-relog). Re-validates and re-encrypts exactly like logDose. */
export async function updateDose(userId: number, id: number, input: DoseInput): Promise<Dose> {
	if (!isValidIsoDate(input.date)) throw new Error('Invalid date');
	const enc = sanitize(input);
	const [row] = await db
		.update(peptideDoses)
		.set({
			peptideId: input.peptideId,
			protocolId: input.protocolId ?? null,
			vialId: input.vialId ?? null,
			date: input.date,
			enc: encryptJson(enc, aad(userId))
		})
		.where(and(eq(peptideDoses.id, id), eq(peptideDoses.userId, userId)))
		.returning();
	if (!row) throw new Error('Dose not found');
	return decode(row);
}

export async function deleteDose(userId: number, id: number): Promise<void> {
	await db.delete(peptideDoses).where(and(eq(peptideDoses.id, id), eq(peptideDoses.userId, userId)));
}

export async function listDoses(
	userId: number,
	opts: { peptideId?: number; from?: string; to?: string; limit?: number } = {}
): Promise<Dose[]> {
	const conds = [eq(peptideDoses.userId, userId)];
	if (opts.peptideId) conds.push(eq(peptideDoses.peptideId, opts.peptideId));
	if (opts.from) conds.push(gte(peptideDoses.date, opts.from));
	if (opts.to) conds.push(lte(peptideDoses.date, opts.to));
	let q = db
		.select()
		.from(peptideDoses)
		.where(and(...conds))
		.orderBy(desc(peptideDoses.date), desc(peptideDoses.createdAt))
		.$dynamic();
	if (opts.limit) q = q.limit(opts.limit);
	return (await q).map(decode);
}

/** Doses logged on a single date (decrypted) — used to reconcile against what's due today. */
export async function dosesOnDate(userId: number, date: string): Promise<Dose[]> {
	const rows = await db
		.select()
		.from(peptideDoses)
		.where(and(eq(peptideDoses.userId, userId), eq(peptideDoses.date, date)))
		.orderBy(asc(peptideDoses.createdAt));
	return rows.map(decode);
}

/** date → number of doses logged, for the adherence calendar. Non-'dose' kinds (priming actuations,
 *  patch removals) are excluded, since neither is an actual dose and shouldn't paint a day as "logged" —
 *  that requires peeking at `kind`, which lives in `enc`, so this decrypts each row in range rather than
 *  running a cleartext SQL count(*) like it used to. Volumes here are small (schema.ts), so that's fine. */
export async function dateCounts(userId: number, from: string, to: string): Promise<Map<string, number>> {
	const rows = await db
		.select({ date: peptideDoses.date, enc: peptideDoses.enc })
		.from(peptideDoses)
		.where(and(eq(peptideDoses.userId, userId), gte(peptideDoses.date, from), lte(peptideDoses.date, to)));
	const counts = new Map<string, number>();
	for (const r of rows) {
		const kind = decryptJson<DoseEnc>(r.enc, aad(userId)).kind ?? 'dose';
		if (kind !== 'dose') continue;
		counts.set(r.date, (counts.get(r.date) ?? 0) + 1);
	}
	return counts;
}

/** Distinct dates a given peptide was dosed within a range — the numerator for that peptide's adherence.
 *  Excludes non-'dose' kinds for the same reason as dateCounts above. */
export async function loggedDatesForPeptide(
	userId: number,
	peptideId: number,
	from: string,
	to: string
): Promise<Set<string>> {
	const rows = await db
		.select({ date: peptideDoses.date, enc: peptideDoses.enc })
		.from(peptideDoses)
		.where(
			and(
				eq(peptideDoses.userId, userId),
				eq(peptideDoses.peptideId, peptideId),
				gte(peptideDoses.date, from),
				lte(peptideDoses.date, to)
			)
		);
	const dates = new Set<string>();
	for (const r of rows) {
		const kind = decryptJson<DoseEnc>(r.enc, aad(userId)).kind ?? 'dose';
		if (kind !== 'dose') continue;
		dates.add(r.date);
	}
	return dates;
}

/** Micrograms consumed per container (vialId), summed across all doses logged against it — the
 *  denominator side of live remaining-supply tracking (pair with containerTotalMcg in
 *  $lib/utils/delivery.ts). Both real doses AND priming actuations draw a container down; only a
 *  patch-removal event doesn't (applying the patch already recorded that consumption), so 'remove' is
 *  the one kind excluded here — the opposite exclusion rule from dateCounts/loggedDatesForPeptide above,
 *  which exclude everything except 'dose'. */
export async function mcgConsumedByVial(userId: number): Promise<Map<number, number>> {
	const rows = await db
		.select({ vialId: peptideDoses.vialId, enc: peptideDoses.enc })
		.from(peptideDoses)
		.where(and(eq(peptideDoses.userId, userId), isNotNull(peptideDoses.vialId)));
	const totals = new Map<number, number>();
	for (const r of rows) {
		if (r.vialId == null) continue;
		const enc = decryptJson<DoseEnc>(r.enc, aad(userId));
		if ((enc.kind ?? 'dose') === 'remove') continue;
		totals.set(r.vialId, (totals.get(r.vialId) ?? 0) + enc.doseMcg);
	}
	return totals;
}

/** The most recent (route, site) pairs, most-recent-first, to feed route-aware rotation suggestions
 *  (see suggestNextSite in $lib/utils/peptides.ts). */
export async function recentSites(userId: number, limit = 20): Promise<{ route: AdminRoute | null; site: ApplicationSite | null }[]> {
	const rows = await db
		.select({ enc: peptideDoses.enc })
		.from(peptideDoses)
		.where(eq(peptideDoses.userId, userId))
		.orderBy(desc(peptideDoses.date), desc(peptideDoses.createdAt))
		.limit(limit);
	return rows.map((r) => {
		const enc = decryptJson<DoseEnc>(r.enc, aad(userId));
		return { route: enc.route ?? null, site: enc.site ?? null };
	});
}
