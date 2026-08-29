import { error } from '@sveltejs/kit';
import { runAssistantTurn, type AssistantEvent } from '$lib/server/ai/assistant';
import { getOrCreateActiveThread } from '$lib/server/repositories/assistant';
import type { RequestHandler } from './$types';

const MAX_MESSAGE_LEN = 4000;

/** Streams one AI Coach turn as newline-delimited JSON (NDJSON) events: {type:'token'|'tool'|'done'|
 *  'error', ...}. Auth is already enforced by hooks.server.ts; the orchestrator re-checks the opt-in
 *  flag, the API-key presence, and the daily quota, surfacing any of them as a terminal 'error' event. */
export const POST: RequestHandler = async ({ request, locals }) => {
	if (!locals.user) throw error(401, 'Not signed in');
	const userId = locals.user.id;

	const body = await request.json().catch(() => null);
	const message = typeof body?.message === 'string' ? body.message.trim() : '';
	if (!message) throw error(400, 'Empty message');
	if (message.length > MAX_MESSAGE_LEN) throw error(400, 'Message too long');

	const threadId = await getOrCreateActiveThread(userId);
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			const send = (event: AssistantEvent) => controller.enqueue(encoder.encode(JSON.stringify(event) + '\n'));
			try {
				await runAssistantTurn(userId, threadId, message, send);
			} catch (err) {
				console.error('AI Coach stream failed', err);
				send({ type: 'error', message: 'The AI Coach request failed. Try again.' });
			} finally {
				controller.close();
			}
		}
	});

	return new Response(stream, {
		headers: { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' }
	});
};
