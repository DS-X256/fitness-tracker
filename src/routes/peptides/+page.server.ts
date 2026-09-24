import { fail } from '@sveltejs/kit';
import { fieldEncryptionAvailable } from '$lib/server/crypto/fieldCrypto';
import { listPeptides } from '$lib/server/repositories/peptides';
import { getProtocol } from '$lib/server/repositories/peptideProtocols';
import { deleteDose, logDose, recentSites, updateDose, updateDoseEffects } from '$lib/server/repositories/peptideDoses';
import { seedPeptidesForUser } from '$lib/server/peptidePresets';
import { getSettings, updateSettings } from '$lib/server/repositories/userSettings';
import { getCached } from '$lib/server/repositories/peptideInsights';
import { aiAvailable } from '$lib/server/ai/client';
import { currentInsightFingerprint, generatePeptideInsight } from '$lib/server/ai/peptideInsights';
import { bestContainer, loadPeptideContext, todayFor, vialStatus } from '$lib/server/peptideContext';
import { activeLevelRows, adherenceSummary, doseRows, dueRows, logModalData } from '$lib/server/peptideViews';
import { todayIso } from '$lib/utils/todayIso';
import { isValidIsoDate } from '$lib/utils/isoDate';
import { parseDecimal } from '$lib/utils/parseDecimal';
import { daysBetween } from '$lib/utils/peptideSchedule';
import { syringeUnits } from '$lib/utils/reconstitution';
import { mcgPerActuation, actuationsForDose, containerConcentrationMgMl } from '$lib/utils/delivery';
import {
	isAdminRoute,
	isApplicationSite,
	isDoseKind,
	isInjectionRoute,
	isMeasureUnit,
	sanitizeEffects,
	suggestNextSite,
	type ApplicationSite,
	type DoseEffect,
	type MeasureUnit
} from '$lib/utils/peptides';
import type { Actions, PageServerLoad } from './$types';

const RECENT_DOSES = 10;

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	if (!fieldEncryptionAvailable()) return { encryptionReady: false as const };

	// Lazily seed the starter catalog on the very first visit (empty catalog), then load everything.
	if ((await listPeptides(userId, { includeInactive: true })).length === 0) {
		await seedPeptidesForUser(userId);
	}

	const [ctx, siteHistory, settings] = await Promise.all([loadPeptideContext(userId), recentSites(userId, 20), getSettings(userId)]);
	const peptideInsight = settings.aiPeptideInsightsEnabled ? await getCached(userId) : null;

	const supply = ctx.vials
		.filter((v) => !v.depleted)
		.map((v) => ({ vial: v, status: vialStatus(ctx, v) }))
		.filter(({ status }) => status.expiry != null || status.low)
		.map(({ vial, status }) => ({
			...status,
			peptideName: ctx.byId.get(vial.peptideId)?.name ?? 'Unknown',
			form: vial.form,
			vialMg: vial.vialMg,
			expiresAt: vial.expiresAt
		}));

	return {
		encryptionReady: true as const,
		today: ctx.today,
		nowMs: Date.now(),
		hasCompounds: ctx.peptides.some((p) => p.active),
		due: dueRows(ctx),
		adherence: adherenceSummary(ctx),
		supply,
		activeLevels: activeLevelRows(ctx),
		siteHistory,
		aiInsightsEnabled: settings.aiPeptideInsightsEnabled,
		aiAvailable: aiAvailable(),
		peptideInsight,
		// A recap written before the latest log/edit/delete (or before today) is flagged, not silently shown.
		insightStale: peptideInsight != null && peptideInsight.fingerprint !== currentInsightFingerprint(ctx),
		recent: doseRows(ctx, ctx.doses.slice(0, RECENT_DOSES)),
		modal: logModalData(ctx)
	};
};

function num(form: FormData, key: string): number | null {
	const raw = String(form.get(key) ?? '').trim();
	if (raw === '') return null;
	const n = parseDecimal(raw);
	return Number.isFinite(n) ? n : null;
}

/** Effects arrive as a JSON array in one hidden field. Absent field → null ("don't touch"), so an edit
 *  from a form that doesn't carry effects never wipes them. */
function parseEffects(form: FormData): DoseEffect[] | null {
	if (!form.has('effects')) return null;
	try {
		return sanitizeEffects(JSON.parse(String(form.get('effects') ?? '[]')));
	} catch {
		return [];
	}
}

/** The client's own local date, trusted only within a day of the server's — covers a server whose TZ
 *  isn't set to the user's, without letting a form post backdate arbitrarily through quick actions. */
function clientDate(form: FormData): string {
	const server = todayIso();
	const raw = String(form.get('clientDate') ?? '').trim();
	if (isValidIsoDate(raw) && Math.abs(daysBetween(server, raw)) <= 1) return raw;
	return server;
}

function clientTime(form: FormData): string | null {
	const raw = String(form.get('clientTime') ?? '').trim();
	return /^\d{2}:\d{2}$/.test(raw) ? raw : null;
}

function doseInput(form: FormData) {
	const peptideId = Number(form.get('peptideId'));
	const kindRaw = String(form.get('kind') ?? '');
	const kind = isDoseKind(kindRaw) ? kindRaw : 'dose';
	const siteRaw = String(form.get('site') ?? '');
	const routeRaw = String(form.get('route') ?? '');
	const vialId = Number(form.get('vialId'));
	const protocolId = Number(form.get('protocolId'));
	const measureUnitRaw = String(form.get('measureUnit') ?? '');
	return {
		peptideId,
		date: String(form.get('date') ?? '').trim() || todayIso(),
		doseMcg: kind === 'skip' ? 0 : (num(form, 'doseMcg') ?? NaN),
		// Broad validators — any application site/route, not just the injection-shaped ones.
		site: isApplicationSite(siteRaw) ? siteRaw : null,
		route: isAdminRoute(routeRaw) ? routeRaw : null,
		time: String(form.get('time') ?? '').trim() || null,
		vialId: Number.isFinite(vialId) && vialId > 0 ? vialId : null,
		protocolId: Number.isFinite(protocolId) && protocolId > 0 ? protocolId : null,
		measureCount: num(form, 'measureCount'),
		measureUnit: isMeasureUnit(measureUnitRaw) ? measureUnitRaw : null,
		kind,
		notes: String(form.get('notes') ?? '').trim() || null,
		effects: parseEffects(form)
	};
}

export const actions: Actions = {
	logDose: async ({ request, locals }) => {
		const form = await request.formData();
		const input = doseInput(form);
		if (!Number.isInteger(input.peptideId) || input.peptideId <= 0) return fail(400, { error: 'Pick a peptide' });
		if (input.kind !== 'skip' && !Number.isFinite(input.doseMcg)) return fail(400, { error: 'Enter a dose' });
		try {
			await logDose(locals.user!.id, input);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not log dose' });
		}
		return { success: true };
	},

	updateDose: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Invalid dose' });
		const input = doseInput(form);
		if (!Number.isInteger(input.peptideId) || input.peptideId <= 0) return fail(400, { error: 'Pick a peptide' });
		if (input.kind !== 'skip' && !Number.isFinite(input.doseMcg)) return fail(400, { error: 'Enter a dose' });
		try {
			await updateDose(locals.user!.id, id, input);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not update dose' });
		}
		return { success: true };
	},

	// One-tap logging of a due protocol: today's target dose (loading/taper aware), the best open
	// container, the next rotation site, and the time it was actually tapped — not the protocol's planned
	// time, which used to make every quick-logged dose look perfectly on schedule.
	quickLog: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const proto = await getProtocol(userId, Number(form.get('protocolId')));
		if (!proto) return fail(400, { error: 'Protocol not found' });
		const date = clientDate(form);
		const ctx = await loadPeptideContext(userId, date);
		const state = todayFor(ctx, proto);
		if (state.mode === 'slots' && state.slots > 0 && state.pending === 0) {
			return fail(400, { error: "Today's doses for this protocol are already logged" });
		}
		const doseMcg = state.targetMcg;

		const route = proto.route ?? null;
		let site: ApplicationSite | null = null;
		if (proto.rotateSites && route) {
			const history = await recentSites(userId, 20);
			site = suggestNextSite(route, history.filter((h) => h.route === route).map((h) => h.site));
		}

		const container = bestContainer(ctx, proto.peptideId, route);
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
			// One application is one patch, whatever its declared strength; doseMcg stays the target.
			measureCount = 1;
			measureUnit = 'patch';
		}

		try {
			await logDose(userId, {
				peptideId: proto.peptideId,
				protocolId: proto.id,
				vialId: container?.id ?? null,
				date,
				doseMcg,
				site,
				route,
				time: clientTime(form),
				measureCount,
				measureUnit,
				kind: 'dose'
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not log dose' });
		}
		return { success: true };
	},

	// "Not taking this one": records a skip against the protocol's next open slot today, so adherence
	// shows it as skipped rather than missed.
	skipDose: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const proto = await getProtocol(userId, Number(form.get('protocolId')));
		if (!proto) return fail(400, { error: 'Protocol not found' });
		const date = clientDate(form);
		const ctx = await loadPeptideContext(userId, date);
		const state = todayFor(ctx, proto);
		const open = state.mode === 'slots' ? state.pending : state.remaining;
		if (open <= 0) return fail(400, { error: 'Nothing left to skip today' });
		try {
			await logDose(userId, {
				peptideId: proto.peptideId,
				protocolId: proto.id,
				date,
				doseMcg: 0,
				route: proto.route,
				time: clientTime(form),
				kind: 'skip',
				notes: String(form.get('reason') ?? '').trim() || null
			});
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not skip' });
		}
		return { success: true };
	},

	setDoseEffects: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Invalid dose' });
		try {
			await updateDoseEffects(locals.user!.id, id, parseEffects(form) ?? []);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save side effects' });
		}
		return { success: true };
	},

	deleteDose: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isFinite(id)) return fail(400, { error: 'Invalid dose' });
		await deleteDose(locals.user!.id, id);
		return { success: true };
	},

	toggleAiInsights: async ({ request, locals }) => {
		const enabled = String((await request.formData()).get('enabled') ?? '') === 'true';
		await updateSettings(locals.user!.id, { aiPeptideInsightsEnabled: enabled });
		return { success: true };
	},

	generatePeptideInsight: async ({ locals }) => {
		const result = await generatePeptideInsight(locals.user!.id);
		if ('error' in result) return fail(502, { error: result.error });
		return { insight: result.insight, fromCache: result.fromCache };
	}
};
