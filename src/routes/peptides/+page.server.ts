import { fail } from '@sveltejs/kit';
import { fieldEncryptionAvailable } from '$lib/server/crypto/fieldCrypto';
import { listPeptides, peptideNameMap } from '$lib/server/repositories/peptides';
import { listProtocols, getProtocol, toSchedule, toLoadingPhase } from '$lib/server/repositories/peptideProtocols';
import { listVials } from '$lib/server/repositories/peptideVials';
import {
	dateCounts,
	deleteDose,
	dosesOnDate,
	listDoses,
	loggedDatesForPeptide,
	logDose,
	mcgConsumedByVial,
	recentSites,
	updateDose
} from '$lib/server/repositories/peptideDoses';
import { seedPeptidesForUser } from '$lib/server/peptidePresets';
import { todayIso } from '$lib/utils/todayIso';
import { shiftIsoDate } from '$lib/utils/isoDate';
import { parseDecimal } from '$lib/utils/parseDecimal';
import { daysBetween, effectiveDoseMcg, isDueOn, isLoadingPhaseOn } from '$lib/utils/peptideSchedule';
import { dosesPerVial, syringeUnits } from '$lib/utils/reconstitution';
import {
	mcgPerActuation,
	actuationsForDose,
	actuationsRemaining,
	daysOfSupply,
	containerConcentrationMgMl,
	containerTotalMcg
} from '$lib/utils/delivery';
import {
	isAdminRoute,
	isApplicationSite,
	isDoseKind,
	isInjectionRoute,
	isMeasureUnit,
	measureUnitForContainerForm,
	suggestNextSite,
	containerFormForRoute,
	type ApplicationSite,
	type MeasureUnit
} from '$lib/utils/peptides';
import type { Actions, PageServerLoad } from './$types';

const ADHERENCE_DAYS = 30;
const CALENDAR_DAYS = 70;
const EXPIRY_SOON_DAYS = 7;

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	if (!fieldEncryptionAvailable()) return { encryptionReady: false as const };

	// Lazily seed the starter catalog on the very first visit (empty catalog), then load everything.
	if ((await listPeptides(userId, { includeInactive: true })).length === 0) {
		await seedPeptidesForUser(userId);
	}

	const today = todayIso();
	const [peptides, protocols, vials, todaysDoses, recent, names, siteHistory, consumedByVial] = await Promise.all([
		listPeptides(userId),
		listProtocols(userId, { activeOnly: true }),
		listVials(userId),
		dosesOnDate(userId, today),
		listDoses(userId, { limit: 8 }),
		peptideNameMap(userId),
		recentSites(userId, 20),
		mcgConsumedByVial(userId)
	]);

	const nameOf = (id: number) => names.get(id)?.name ?? 'Unknown';

	// --- Due today (active protocols scheduled for today, reconciled against what's logged) ---
	const loggedToday = new Set(todaysDoses.map((d) => d.peptideId));
	const due = protocols
		.filter((p) => isDueOn(toSchedule(p), today))
		.map((p) => ({
			protocolId: p.id,
			peptideId: p.peptideId,
			peptideName: nameOf(p.peptideId),
			doseMcg: effectiveDoseMcg(p.doseMcg, p.startDate, toLoadingPhase(p), today),
			loading: isLoadingPhaseOn(p.startDate, toLoadingPhase(p), today),
			route: p.route,
			timeOfDay: p.timeOfDay,
			logged: loggedToday.has(p.peptideId)
		}));

	// --- 30-day adherence (logged ÷ scheduled across all active protocols) ---
	const windowStart = shiftIsoDate(today, -(ADHERENCE_DAYS - 1));
	let dueTotal = 0;
	let dueTaken = 0;
	for (const p of protocols) {
		const s = toSchedule(p);
		const start = p.startDate > windowStart ? p.startDate : windowStart;
		if (start > today) continue;
		const logged = await loggedDatesForPeptide(userId, p.peptideId, start, today);
		const span = daysBetween(start, today);
		for (let i = 0; i <= span; i++) {
			const d = shiftIsoDate(start, i);
			if (isDueOn(s, d)) {
				dueTotal++;
				if (logged.has(d)) dueTaken++;
			}
		}
	}
	const adherence = dueTotal > 0 ? { pct: Math.round((dueTaken / dueTotal) * 100), taken: dueTaken, total: dueTotal } : null;

	// --- Calendar (last 10 weeks: logged count + whether anything was due) ---
	const calFrom = shiftIsoDate(today, -(CALENDAR_DAYS - 1));
	const counts = await dateCounts(userId, calFrom, today);
	const calendar: { date: string; count: number; due: boolean }[] = [];
	for (let i = 0; i <= daysBetween(calFrom, today); i++) {
		const d = shiftIsoDate(calFrom, i);
		calendar.push({ date: d, count: counts.get(d) ?? 0, due: protocols.some((p) => isDueOn(toSchedule(p), d)) });
	}

	// --- Vial alerts: expiry + "doses left" + days-of-supply, per container form. ---
	const vialAlerts = vials.map((v) => {
		const proto = protocols.find((p) => p.peptideId === v.peptideId);
		const totalMcg = containerTotalMcg(v);
		const remainingMcg = totalMcg != null ? Math.max(0, totalMcg - (consumedByVial.get(v.id) ?? 0)) : null;

		let dosesLeft: number | null = null;
		if (v.form === 'vial') {
			// Kept exactly as before remaining-supply tracking existed: a plain dose-count estimate
			// (dosesLogged is a row count, not an mcg sum), so this stays byte-identical to before.
			dosesLeft = proto && v.vialMg != null ? Math.max(0, dosesPerVial(v.vialMg, proto.doseMcg) - v.dosesLogged) : null;
		} else if ((v.form === 'nasal_spray' || v.form === 'serum') && remainingMcg != null && v.actuationVolumeUl) {
			const conc = containerConcentrationMgMl(v);
			const mpa = conc != null ? mcgPerActuation(conc, v.actuationVolumeUl) : null;
			if (mpa != null && mpa > 0) dosesLeft = actuationsRemaining(remainingMcg, mpa);
		} else if ((v.form === 'capsules' || v.form === 'patches') && remainingMcg != null && v.unitMassMcg) {
			dosesLeft = Math.floor(remainingMcg / v.unitMassMcg);
		}

		const daysLeftRaw = proto && proto.doseMcg > 0 && remainingMcg != null ? daysOfSupply(remainingMcg, proto.doseMcg) : null;
		const daysLeft = daysLeftRaw != null && Number.isFinite(daysLeftRaw) ? daysLeftRaw : null;

		let expiry: 'expired' | 'soon' | null = null;
		if (v.expiresAt) {
			if (v.expiresAt < today) expiry = 'expired';
			else if (daysBetween(today, v.expiresAt) <= EXPIRY_SOON_DAYS) expiry = 'soon';
		}
		return {
			id: v.id,
			peptideName: nameOf(v.peptideId),
			form: v.form,
			vialMg: v.vialMg,
			expiresAt: v.expiresAt,
			expiry,
			dosesLeft,
			daysLeft,
			unit: measureUnitForContainerForm(v.form),
			low: dosesLeft != null && dosesLeft <= 3
		};
	});

	return {
		encryptionReady: true as const,
		today,
		peptides,
		due,
		adherence,
		calendar,
		vialAlerts,
		siteHistory,
		recent: recent.map((d) => ({ ...d, peptideName: nameOf(d.peptideId) })),
		// For the log-dose modal: active containers, with everything the delivery calculators need.
		activeVials: vials.map((v) => ({
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
			unitMassMcg: v.unitMassMcg
		}))
	};
};

function num(form: FormData, key: string): number | null {
	const raw = String(form.get(key) ?? '').trim();
	if (raw === '') return null;
	const n = parseDecimal(raw);
	return Number.isFinite(n) ? n : null;
}

export const actions: Actions = {
	logDose: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const peptideId = Number(form.get('peptideId'));
		if (!Number.isFinite(peptideId)) return fail(400, { error: 'Pick a peptide' });
		const doseMcg = num(form, 'doseMcg');
		if (doseMcg == null) return fail(400, { error: 'Enter a dose in mcg' });
		const siteRaw = String(form.get('site') ?? '');
		const routeRaw = String(form.get('route') ?? '');
		const vialId = Number(form.get('vialId'));
		const protocolId = Number(form.get('protocolId'));
		const measureCount = num(form, 'measureCount');
		const measureUnitRaw = String(form.get('measureUnit') ?? '');
		const kindRaw = String(form.get('kind') ?? '');
		try {
			await logDose(userId, {
				peptideId,
				date: String(form.get('date') ?? '').trim() || todayIso(),
				doseMcg,
				// Broad validators — any application site/route, not just the injection-shaped ones.
				site: isApplicationSite(siteRaw) ? siteRaw : null,
				route: isAdminRoute(routeRaw) ? routeRaw : null,
				time: String(form.get('time') ?? '').trim() || null,
				vialId: Number.isFinite(vialId) && vialId > 0 ? vialId : null,
				protocolId: Number.isFinite(protocolId) && protocolId > 0 ? protocolId : null,
				measureCount,
				measureUnit: isMeasureUnit(measureUnitRaw) ? measureUnitRaw : null,
				kind: isDoseKind(kindRaw) ? kindRaw : 'dose',
				notes: String(form.get('notes') ?? '').trim() || null
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not log dose' });
		}
		return { success: true };
	},

	updateDose: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isFinite(id)) return fail(400, { error: 'Invalid dose' });
		const peptideId = Number(form.get('peptideId'));
		if (!Number.isFinite(peptideId)) return fail(400, { error: 'Pick a peptide' });
		const doseMcg = num(form, 'doseMcg');
		if (doseMcg == null) return fail(400, { error: 'Enter a dose in mcg' });
		const siteRaw = String(form.get('site') ?? '');
		const routeRaw = String(form.get('route') ?? '');
		const vialId = Number(form.get('vialId'));
		const protocolId = Number(form.get('protocolId'));
		const measureCount = num(form, 'measureCount');
		const measureUnitRaw = String(form.get('measureUnit') ?? '');
		const kindRaw = String(form.get('kind') ?? '');
		try {
			await updateDose(userId, id, {
				peptideId,
				date: String(form.get('date') ?? '').trim() || todayIso(),
				doseMcg,
				site: isApplicationSite(siteRaw) ? siteRaw : null,
				route: isAdminRoute(routeRaw) ? routeRaw : null,
				time: String(form.get('time') ?? '').trim() || null,
				vialId: Number.isFinite(vialId) && vialId > 0 ? vialId : null,
				protocolId: Number.isFinite(protocolId) && protocolId > 0 ? protocolId : null,
				measureCount,
				measureUnit: isMeasureUnit(measureUnitRaw) ? measureUnitRaw : null,
				kind: isDoseKind(kindRaw) ? kindRaw : 'dose',
				notes: String(form.get('notes') ?? '').trim() || null
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not update dose' });
		}
		return { success: true };
	},

	// One-tap logging of a due protocol at today's date, rotating to the suggested site.
	quickLog: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const protocolId = Number(form.get('protocolId'));
		const proto = await getProtocol(userId, protocolId);
		if (!proto) return fail(400, { error: 'Protocol not found' });
		const today = todayIso();
		const doseMcg = effectiveDoseMcg(proto.doseMcg, proto.startDate, toLoadingPhase(proto), today);

		const route = proto.route ?? null;
		let site: ApplicationSite | null = null;
		if (proto.rotateSites && route) {
			const history = await recentSites(userId, 20);
			site = suggestNextSite(route, history.filter((h) => h.route === route).map((h) => h.site));
		}

		const containers = await listVials(userId, { peptideId: proto.peptideId });
		const wantForm = containerFormForRoute(route);
		const container = containers.find((v) => v.form === wantForm) ?? (wantForm ? null : containers[0]) ?? null;

		let measureCount: number | null = null;
		let measureUnit: MeasureUnit | null = null;
		if (route && isInjectionRoute(route) && container?.form === 'vial' && container.vialMg != null && container.bacWaterMl) {
			measureCount = syringeUnits({ vialMg: container.vialMg, bacWaterMl: container.bacWaterMl, doseMcg });
			measureUnit = 'unit';
		} else if (route === 'intranasal' && container?.form === 'nasal_spray' && container.actuationVolumeUl) {
			const conc = containerConcentrationMgMl(container);
			if (conc != null) {
				const mpa = mcgPerActuation(conc, container.actuationVolumeUl);
				if (mpa > 0) {
					measureCount = actuationsForDose(doseMcg, mpa).whole;
					measureUnit = 'spray';
				}
			}
		} else if (route === 'transdermal' && container?.form === 'patches') {
			// A patch isn't dialed in like a spray count — one application is one patch, whatever its
			// declared strength. doseMcg below stays the protocol's own target either way.
			measureCount = 1;
			measureUnit = 'patch';
		}

		try {
			await logDose(userId, {
				peptideId: proto.peptideId,
				protocolId: proto.id,
				vialId: container?.id ?? null,
				date: today,
				doseMcg,
				site,
				route,
				time: proto.timeOfDay,
				measureCount,
				measureUnit,
				kind: 'dose'
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not log dose' });
		}
		return { success: true };
	},

	deleteDose: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isFinite(id)) return fail(400, { error: 'Invalid dose' });
		await deleteDose(locals.user!.id, id);
		return { success: true };
	}
};
