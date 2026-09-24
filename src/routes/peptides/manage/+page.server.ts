import { fail } from '@sveltejs/kit';
import { fieldEncryptionAvailable } from '$lib/server/crypto/fieldCrypto';
import { createPeptide, deletePeptide, listPeptides, setPeptideActive, updatePeptide } from '$lib/server/repositories/peptides';
import { createProtocol, deleteProtocol, listProtocols, setProtocolActive, updateProtocol } from '$lib/server/repositories/peptideProtocols';
import { createVial, deleteVial, listVials, setVialDepleted, updateVial } from '$lib/server/repositories/peptideVials';
import { seedPeptidesForUser } from '$lib/server/peptidePresets';
import { parseDecimal } from '$lib/utils/parseDecimal';
import { isPeptideCategory, isAdminRoute, isContainerForm, type BlendComponent } from '$lib/utils/peptides';
import { isFrequency, scheduleLabel } from '$lib/utils/peptideSchedule';
import { toSchedule } from '$lib/server/repositories/peptideProtocols';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	if (!fieldEncryptionAvailable()) {
		return { encryptionReady: false as const, peptides: [], protocols: [], vials: [] };
	}
	const [peptides, protocols, vials] = await Promise.all([
		listPeptides(userId, { includeInactive: true }),
		listProtocols(userId),
		listVials(userId, { includeDepleted: true })
	]);
	const nameOf = new Map(peptides.map((p) => [p.id, p.name]));
	return {
		encryptionReady: true as const,
		peptides,
		protocols: protocols.map((p) => ({ ...p, peptideName: nameOf.get(p.peptideId) ?? 'Unknown', schedule: scheduleLabel(toSchedule(p)) })),
		vials: vials.map((v) => ({ ...v, peptideName: nameOf.get(v.peptideId) ?? 'Unknown' }))
	};
};

function num(form: FormData, key: string): number | null {
	const raw = String(form.get(key) ?? '').trim();
	if (raw === '') return null;
	const n = parseDecimal(raw);
	return Number.isFinite(n) ? n : null;
}
function str(form: FormData, key: string): string | null {
	const v = String(form.get(key) ?? '').trim();
	return v || null;
}
function weekdayMask(form: FormData): number {
	let mask = 0;
	for (const v of form.getAll('weekday')) {
		const d = Number(v);
		if (Number.isInteger(d) && d >= 0 && d <= 6) mask |= 1 << d;
	}
	return mask;
}

/** The BlendMixEditor's parallel arrays → component rows (label mg and/or percent, plus the link id). */
function parseComponents(form: FormData): BlendComponent[] {
	const names = form.getAll('componentName').map(String);
	const mgs = form.getAll('componentMg').map(String);
	const pcts = form.getAll('componentPercent').map(String);
	const ids = form.getAll('componentPeptideId').map(String);
	const dec = (raw: string | undefined) => {
		const t = (raw ?? '').trim();
		return t === '' ? null : parseDecimal(t);
	};
	return names.map((name, i) => {
		const id = Number(ids[i]);
		return {
			name,
			labelMg: dec(mgs[i]),
			percent: dec(pcts[i]) ?? NaN,
			peptideId: Number.isInteger(id) && id > 0 ? id : null
		};
	});
}

export const actions: Actions = {
	seedPresets: async ({ locals }) => {
		const added = await seedPeptidesForUser(locals.user!.id);
		return { success: true, added };
	},

	// --- Compounds ---
	savePeptide: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = Number(form.get('id'));
		const category = String(form.get('category') ?? '');
		const isBlend = form.get('isBlend') === 'on';
		const input = {
			name: str(form, 'name') ?? '',
			category: isPeptideCategory(category) ? category : null,
			vialMg: num(form, 'vialMg'),
			notes: str(form, 'notes'),
			isBlend,
			components: isBlend ? parseComponents(form) : null,
			halfLifeHours: isBlend ? null : num(form, 'halfLifeHours')
		};
		try {
			if (Number.isFinite(id) && id > 0) await updatePeptide(userId, id, input);
			else await createPeptide(userId, input);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save peptide' });
		}
		return { success: true };
	},
	// One-tap "use the standard half-life" from the compound page / levels screen, so the level graph appears.
	setHalfLife: async ({ request, locals }) => {
		const form = await request.formData();
		const id = Number(form.get('id'));
		const hours = num(form, 'halfLifeHours');
		if (!Number.isInteger(id) || id <= 0) return fail(400, { error: 'Invalid compound' });
		try {
			await updatePeptide(locals.user!.id, id, { halfLifeHours: hours });
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save half-life' });
		}
		return { success: true };
	},
	togglePeptide: async ({ request, locals }) => {
		const form = await request.formData();
		await setPeptideActive(locals.user!.id, Number(form.get('id')), form.get('active') === 'true');
		return { success: true };
	},
	// Deleting a compound deletes its whole dose history (FK cascade), so the page confirms first and
	// this refuses without that confirmation — a stray tap can't wipe months of log.
	deletePeptide: async ({ request, locals }) => {
		const form = await request.formData();
		if (form.get('confirm') !== 'yes') return fail(400, { error: 'Confirm deleting this compound and its history' });
		await deletePeptide(locals.user!.id, Number(form.get('id')));
		return { success: true };
	},

	// --- Protocols ---
	saveProtocol: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = Number(form.get('id'));
		const frequency = String(form.get('frequency') ?? '');
		const route = String(form.get('route') ?? '');
		const doseMcg = num(form, 'doseMcg');
		if (doseMcg == null) return fail(400, { error: 'Enter a dose' });
		if (!isFrequency(frequency)) return fail(400, { error: 'Pick a frequency' });
		const input = {
			peptideId: Number(form.get('peptideId')),
			doseMcg,
			route: isAdminRoute(route) ? route : null,
			frequency,
			weekdayMask: frequency === 'weekly' ? weekdayMask(form) : null,
			perWeek: num(form, 'perWeek'),
			intervalDays: num(form, 'intervalDays'),
			timesPerDay: num(form, 'timesPerDay'),
			timeOfDay: str(form, 'timeOfDay'),
			startDate: str(form, 'startDate') ?? '',
			endDate: str(form, 'endDate'),
			cycleWeeksOn: num(form, 'cycleWeeksOn'),
			cycleWeeksOff: num(form, 'cycleWeeksOff'),
			rotateSites: form.get('rotateSites') === 'on',
			notes: str(form, 'notes'),
			loadingDoseMcg: num(form, 'loadingDoseMcg'),
			loadingDurationDays: num(form, 'loadingDurationDays'),
			taperDoseMcg: num(form, 'taperDoseMcg'),
			taperAfterDays: num(form, 'taperAfterDays'),
			components: form.get('customMix') === 'on' ? parseComponents(form) : null
		};
		try {
			if (Number.isFinite(id) && id > 0) await updateProtocol(userId, id, input);
			else await createProtocol(userId, input);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save protocol' });
		}
		return { success: true };
	},
	toggleProtocol: async ({ request, locals }) => {
		const form = await request.formData();
		await setProtocolActive(locals.user!.id, Number(form.get('id')), form.get('active') === 'true');
		return { success: true };
	},
	deleteProtocol: async ({ request, locals }) => {
		await deleteProtocol(locals.user!.id, Number((await request.formData()).get('id')));
		return { success: true };
	},

	// --- Vials ---
	saveVial: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const id = Number(form.get('id'));
		const formValue = String(form.get('form') ?? '');
		const container = isContainerForm(formValue) ? formValue : 'vial';
		const vialMg = num(form, 'vialMg');
		if (container === 'vial' && vialMg == null) return fail(400, { error: 'Enter the vial size in mg' });
		const input = {
			peptideId: Number(form.get('peptideId')),
			form: container,
			vialMg,
			bacWaterMl: num(form, 'bacWaterMl'),
			reconstitutedAt: str(form, 'reconstitutedAt'),
			expiresAt: str(form, 'expiresAt'),
			notes: str(form, 'notes'),
			concentrationMgMl: num(form, 'concentrationMgMl'),
			percentWv: num(form, 'percentWv'),
			actuationVolumeUl: num(form, 'actuationVolumeUl'),
			primingActuations: num(form, 'primingActuations'),
			unitCount: num(form, 'unitCount'),
			unitMassMcg: num(form, 'unitMassMcg')
		};
		try {
			if (Number.isFinite(id) && id > 0) await updateVial(userId, id, input);
			else await createVial(userId, input);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save vial' });
		}
		return { success: true };
	},
	toggleVial: async ({ request, locals }) => {
		const form = await request.formData();
		await setVialDepleted(locals.user!.id, Number(form.get('id')), form.get('depleted') === 'true');
		return { success: true };
	},
	deleteVial: async ({ request, locals }) => {
		await deleteVial(locals.user!.id, Number((await request.formData()).get('id')));
		return { success: true };
	}
};
