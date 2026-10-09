import { error } from '@sveltejs/kit';
import { readFile } from 'node:fs/promises';
import { db } from '$lib/server/db';
import { meals } from '$lib/server/db/schema';
import { eq } from 'drizzle-orm';
import { canViewMeal } from '$lib/server/repositories/mealShares';
import { mealPhotoPath } from '$lib/server/storage/mealPhotos';
import type { RequestHandler } from './$types';

const CONTENT_TYPES: Record<string, string> = {
	jpg: 'image/jpeg',
	png: 'image/png',
	webp: 'image/webp'
};

export const GET: RequestHandler = async ({ params, locals }) => {
	const id = Number(params.id);
	if (!locals.user || !Number.isFinite(id)) throw error(404, 'Not found');
	if (!(await canViewMeal(locals.user.id, id))) throw error(404, 'Not found');

	const [row] = await db.select({ photoFilename: meals.photoFilename }).from(meals).where(eq(meals.id, id));
	if (!row?.photoFilename) throw error(404, 'No photo');

	const ext = row.photoFilename.split('.').pop() ?? '';
	const contentType = CONTENT_TYPES[ext] ?? 'application/octet-stream';

	try {
		const data = await readFile(mealPhotoPath(row.photoFilename));
		return new Response(data, {
			headers: {
				'Content-Type': contentType,
				// Belt-and-braces against a disguised non-image slipping through: never let the
				// browser second-guess the declared type into something executable.
				'X-Content-Type-Options': 'nosniff',
				'Cache-Control': 'private, no-store'
			}
		});
	} catch {
		throw error(404, 'No photo');
	}
};
