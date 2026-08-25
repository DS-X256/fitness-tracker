import { listPhotos } from '$lib/server/repositories/peptidePhotos';
import { listPeptides } from '$lib/server/repositories/peptides';
import type { PageServerLoad } from './$types';

export const load: PageServerLoad = async ({ locals }) => {
	const userId = locals.user!.id;
	// listPhotos returns newest-first and never exposes the on-disk filename — only ids the owner can
	// resolve through the ownership-checked serve route.
	const [photos, peptides] = await Promise.all([listPhotos(userId), listPeptides(userId, { includeInactive: true })]);
	return { photos, peptides };
};
