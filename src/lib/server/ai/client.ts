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

/** The AI Coach chat: multi-step reasoning over the user's data + literature + web search, giving
 *  labelled estimates where evidence is thin. Overridable per deployment (e.g. AI_MODEL_COACH=claude-opus-5)
 *  when depth matters more than cost. */
export const AI_MODEL_COACH = env.AI_MODEL_COACH?.trim() || AI_MODEL_SONNET;
/** The peptide dashboard recap. Same default: it has to get blends, phases and schedules exactly right. */
export const AI_MODEL_PEPTIDE_SUMMARY = env.AI_MODEL_PEPTIDE_SUMMARY?.trim() || 'claude-opus-5';

/** Server-side web search for the AI Coach (on unless AI_WEB_SEARCH=off). Billed per search, and must be
 *  enabled for the organization in the Anthropic Console — assistant.ts falls back to no search if not. */
export const AI_WEB_SEARCH_ENABLED = !['off', 'false', '0', 'no'].includes((env.AI_WEB_SEARCH ?? '').trim().toLowerCase());

/** Server-side refusal fallback (`fallbacks: 'default'`) is only accepted on some models. */
export function supportsRefusalFallback(model: string): boolean {
	return model.startsWith('claude-opus-5') || model.startsWith('claude-fable-5');
}

/** `output_config.effort` isn't accepted by Haiku 4.5 (it errors), so only pass it where supported. */
export function supportsEffort(model: string): boolean {
	return !model.startsWith('claude-haiku');
}

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

/** The shared Anthropic client, or null when no key is configured. Exported so the streaming chat
 *  assistant (which can't use the one-shot generateText path) can drive `client.messages.stream()`
 *  directly while still resolving the API key in this one place. */
export function getClient(): Anthropic | null {
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
 *  key doesn't eat into a user's daily budget. No thinking config is passed: Opus 5 / Sonnet 5 run
 *  adaptive thinking automatically when omitted (depth steered by `effort`), and Haiku 4.5 simply runs
 *  without thinking. On the thinking models, maxTokens must leave room for the thinking as well. */
export async function generateText(opts: {
	userId: number;
	model: string;
	system: string;
	prompt: string;
	maxTokens: number;
	/** Thinking/effort depth (models that support it). Omitted = the model's default. */
	effort?: 'low' | 'medium' | 'high';
	/** Per-request timeout override — thinking models need more than the client's 30 s default. */
	timeoutMs?: number;
}): Promise<GenerateTextResult> {
	const c = getClient();
	if (!c) return { ok: false, reason: 'not_configured' };

	const today = todayIso();
	const usedToday = await getUsageToday(opts.userId, today);
	if (usedToday >= AI_DAILY_LIMIT_PER_USER) return { ok: false, reason: 'rate_limited' };

	try {
		// Beta endpoint so a safety-classifier decline can be retried server-side on the recommended model
		// (`fallbacks: 'default'`) instead of surfacing as a failed summary.
		const res = await c.beta.messages.create(
			{
				model: opts.model,
				max_tokens: opts.maxTokens,
				system: opts.system,
				messages: [{ role: 'user', content: opts.prompt }],
				...(opts.effort && supportsEffort(opts.model) ? { output_config: { effort: opts.effort } } : {}),
				...(supportsRefusalFallback(opts.model)
					? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const }
					: {})
			},
			opts.timeoutMs ? { timeout: opts.timeoutMs } : undefined
		);
		if (res.stop_reason === 'refusal') {
			console.error('AI generateText refused', res.stop_details);
			return { ok: false, reason: 'failed' };
		}
		// A thinking model returns thinking block(s) before the text; join every text block.
		const text = res.content
			.filter((b): b is Extract<typeof b, { type: 'text' }> => b.type === 'text')
			.map((b) => b.text)
			.join('')
			.trim();
		if (!text) return { ok: false, reason: 'failed' };
		await incrementUsage(opts.userId, today);
		return { ok: true, text, model: res.model };
	} catch (err) {
		console.error('AI generateText failed', err);
		return { ok: false, reason: 'failed' };
	}
}
