// Thin, shared wrapper around the Anthropic SDK for the app's optional AI features (workout coach,
// weekly digest, peptide adherence insights). Mirrors the barcode route's philosophy for external
// calls: server-side only, degrade gracefully on any failure rather than surfacing a 500, and let each
// feature's own repository cache the result so repeat views never re-call the API.
//
// Not configured (no ANTHROPIC_API_KEY) is a supported, first-class state, not an error — callers use
// aiAvailable() to render a "not configured" UI instead of attempting a call.
//
// The daily quota lives here rather than in each orchestrator so it can't be forgotten by a future
// fourth AI feature: every call to generateText is quota-checked and, on success, counted, in one place.

import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';
import { getUsageToday, incrementUsage } from '$lib/server/repositories/aiUsage';
import { todayIso } from '$lib/utils/todayIso';

/** Real coaching judgment (progressive-overload calls, muscle-balance reasoning) — worth the stronger tier. */
export const AI_MODEL_SONNET = 'claude-sonnet-5';
/** Mechanical summarization over well-defined structured input — cheapest capable tier. */
export const AI_MODEL_HAIKU = 'claude-haiku-4-5';

/** Shared cap across all three AI features combined — each feature's own cooldown throttles how often
 *  *one* thing (a session, a week, the peptide summary) can be regenerated, but nothing otherwise caps
 *  total spend across a day (many sessions, many regenerate clicks). Overridable per-deployment since
 *  "fair" depends on how many people share one instance and one API budget. */
export const AI_DAILY_LIMIT_PER_USER = (() => {
	const raw = Number(env.AI_DAILY_LIMIT_PER_USER);
	return Number.isInteger(raw) && raw > 0 ? raw : 15;
})();

// undefined = not yet resolved; null = configured-as-absent; Anthropic = the client.
let client: Anthropic | null | undefined;

function getClient(): Anthropic | null {
	if (client !== undefined) return client;
	const apiKey = env.ANTHROPIC_API_KEY?.trim();
	// Short timeout + a single retry: these calls run synchronously inside a page action, not a
	// background job, so a hung upstream request must fail fast rather than block the request for minutes.
	client = apiKey ? new Anthropic({ apiKey, timeout: 30_000, maxRetries: 1 }) : null;
	return client;
}

/** Whether an API key is configured. Routes use this to render a "not configured" state up front
 *  rather than attempting a call that can only fail. */
export function aiAvailable(): boolean {
	return getClient() !== null;
}

export type GenerateTextResult =
	| { ok: true; text: string; model: string }
	| { ok: false; reason: 'not_configured' | 'rate_limited' | 'failed' };

/** Single non-streaming text generation, quota-checked and quota-counted. A failed or not-configured
 *  call never consumes quota — only a genuine successful generation does, so an outage or a misconfigured
 *  key doesn't eat into a user's daily budget. No thinking config is passed: Sonnet 5 runs adaptive
 *  thinking automatically when omitted (fine for the coaching feature's reasoning), and Haiku 4.5 has no
 *  adaptive mode and simply runs without thinking (fine for pure summarization). */
export async function generateText(opts: {
	userId: number;
	model: string;
	system: string;
	prompt: string;
	maxTokens: number;
}): Promise<GenerateTextResult> {
	const c = getClient();
	if (!c) return { ok: false, reason: 'not_configured' };

	const today = todayIso();
	const usedToday = await getUsageToday(opts.userId, today);
	if (usedToday >= AI_DAILY_LIMIT_PER_USER) return { ok: false, reason: 'rate_limited' };

	try {
		const res = await c.messages.create({
			model: opts.model,
			max_tokens: opts.maxTokens,
			system: opts.system,
			messages: [{ role: 'user', content: opts.prompt }]
		});
		const block = res.content.find((b) => b.type === 'text');
		if (!block || block.type !== 'text') return { ok: false, reason: 'failed' };
		await incrementUsage(opts.userId, today);
		return { ok: true, text: block.text, model: res.model };
	} catch (err) {
		console.error('AI generateText failed', err);
		return { ok: false, reason: 'failed' };
	}
}
