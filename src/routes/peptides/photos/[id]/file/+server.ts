import { error } from '@sveltejs/kit';
import { getPhotoForOwner } from '$lib/server/repositories/peptidePhotos';
import { readPeptidePhoto } from '$lib/server/storage/peptidePhotos';
import type { RequestHandler } from './$types';

// Serves a decrypted peptide photo — but only to the account that owns it. hooks.server.ts already
// requires a session for /peptides/*; this additionally enforces per-row ownership and returns 404 (never
// 401/403) for both "no such photo" and "not yours" so the endpoint reveals nothing about other users.
export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!locals.user || !Number.isFinite(id)) throw error(404, 'Not found');

	const row = await getPhotoForOwner(locals.user.id, id);
	if (!row) throw error(404, 'Not found');

	try {
		const data = await readPeptidePhoto(locals.user.id, row.filename);
		// Wrap in a plain Uint8Array so the (possibly shared-backed) decrypt Buffer satisfies BodyInit.
		return new Response(new Uint8Array(data), {
			headers: {
				'Content-Type': row.mime,
				// Never let the browser second-guess the type into something executable.
				'X-Content-Type-Options': 'nosniff',
				// The image has no legitimate sub-resources; lock it down.
				'Content-Security-Policy': "default-src 'none'",
				'Referrer-Policy': 'no-referrer',
				// Sensitive: keep it out of shared caches and off disk after viewing.
				'Cache-Control': 'private, no-store, max-age=0'
			}
		});
	} catch {
		throw error(404, 'Not found');
	}
};
