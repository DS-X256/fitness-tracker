import { fail } from '@sveltejs/kit';
import { deletePhoto, listPhotos, savePhoto } from '$lib/server/repositories/peptidePhotos';
import { listPeptides } from '$lib/server/repositories/peptides';
import { photoEncryptionAvailable } from '$lib/server/crypto/photoCrypto';
import { todayIso } from '$lib/utils/todayIso';
import type { Actions, PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals, url }) => {
	const userId = locals.user!.id;
	const peptideIdRaw = Number(url.searchParams.get('peptideId'));
	const peptideId = Number.isFinite(peptideIdRaw) && peptideIdRaw > 0 ? peptideIdRaw : null;
	const [photos, peptides] = await Promise.all([
		listPhotos(userId, peptideId ? { peptideId } : {}),
		listPeptides(userId, { includeInactive: true })
	]);
	return { photos, peptides, peptideId, encryptionReady: photoEncryptionAvailable() };
};

export const actions: Actions = {
	upload: async ({ request, locals }) => {
		const userId = locals.user!.id;
		const form = await request.formData();
		const file = form.get('photo');
		if (!(file instanceof File) || file.size === 0) return fail(400, { error: 'Choose a photo first' });

		const date = String(form.get('date') ?? '').trim() || todayIso();
		const peptideIdRaw = Number(form.get('peptideId'));
		const peptideId = Number.isFinite(peptideIdRaw) && peptideIdRaw > 0 ? peptideIdRaw : null;
		const caption = String(form.get('caption') ?? '');

		try {
			await savePhoto(userId, { peptideId, date, caption }, file);
		} catch (e) {
			return fail(400, { error: e instanceof Error ? e.message : 'Could not save photo' });
		}
		return { success: true };
	},

	delete: async ({ request, locals }) => {
		const id = Number((await request.formData()).get('id'));
		if (!Number.isFinite(id)) return fail(400, { error: 'Invalid photo' });
		await deletePhoto(locals.user!.id, id);
		return { success: true };
	}
};
