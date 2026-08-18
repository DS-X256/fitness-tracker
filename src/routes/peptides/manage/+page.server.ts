import { fail } from '@sveltejs/kit';
import { fieldEncryptionAvailable } from '$lib/server/crypto/fieldCrypto';
import {
	createPeptide,
	deletePeptide,
	listPeptides,
	setPeptideActive,
	updatePeptide
} from '$lib/server/repositories/peptides';
import {
	createProtocol,
	deleteProtocol,
	listProtocols,
	setProtocolActive,
	updateProtocol
} from '$lib/server/repositories/peptideProtocols';
import { createVial, deleteVial, listVials, setVialDepleted } from '$lib/server/repositories/peptideVials';
import { seedPeptidesForUser } from '$lib/server/peptidePresets';
import { parseDecimal } from '$lib/utils/parseDecimal';
import { isPeptideCategory, isAdminRoute, isContainerForm } from '$lib/utils/peptides';
import { isFrequency } from '$lib/utils/peptideSchedule';
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
		protocols: protocols.map((p) => ({ ...p, peptideName: nameOf.get(p.peptideId) ?? 'Unknown' })),
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
		const input = {
			name: str(form, 'name') ?? '',
			category: isPeptideCategory(category) ? category : null,
			vialMg: num(form, 'vialMg'),
			notes: str(form, 'notes')
		};
		try {
			if (Number.isFinite(id) && id > 0) await updatePeptide(userId, id, input);
			else await createPeptide(userId, input);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save peptide' });
		}
		return { success: true };
	},
	togglePeptide: async ({ request, locals }) => {
		const form = await request.formData();
		await setPeptideActive(locals.user!.id, Number(form.get('id')), form.get('active') === 'true');
		return { success: true };
	},
	deletePeptide: async ({ request, locals }) => {
		await deletePeptide(locals.user!.id, Number((await request.formData()).get('id')));
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
		if (doseMcg == null) return fail(400, { error: 'Enter a dose in mcg' });
		if (!isFrequency(frequency)) return fail(400, { error: 'Pick a frequency' });
		const input = {
			peptideId: Number(form.get('peptideId')),
			doseMcg,
			route: isAdminRoute(route) ? route : null,
			frequency,
			weekdayMask: frequency === 'weekly' ? weekdayMask(form) : null,
			perWeek: num(form, 'perWeek'),
			timeOfDay: str(form, 'timeOfDay'),
			startDate: str(form, 'startDate') ?? '',
			endDate: str(form, 'endDate'),
			cycleWeeksOn: num(form, 'cycleWeeksOn'),
			cycleWeeksOff: num(form, 'cycleWeeksOff'),
			rotateSites: form.get('rotateSites') === 'on',
			notes: str(form, 'notes'),
			loadingDoseMcg: num(form, 'loadingDoseMcg'),
			loadingDurationDays: num(form, 'loadingDurationDays')
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
		const formValue = String(form.get('form') ?? '');
		const container = isContainerForm(formValue) ? formValue : 'vial';
		const vialMg = num(form, 'vialMg');
		if (container === 'vial' && vialMg == null) return fail(400, { error: 'Enter the vial size in mg' });
		try {
			await createVial(userId, {
				peptideId: Number(form.get('peptideId')),
				form: container,
				vialMg,
				bacWaterMl: num(form, 'bacWaterMl'),
				reconstitutedAt: str(form, 'reconstitutedAt'),
				expiresAt: str(form, 'expiresAt'),
				notes: str(form, 'notes'),
				concentrationMgMl: num(form, 'concentrationMgMl'),
				actuationVolumeUl: num(form, 'actuationVolumeUl'),
				primingActuations: num(form, 'primingActuations'),
				unitCount: num(form, 'unitCount'),
				unitMassMcg: num(form, 'unitMassMcg')
			});
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
