// Thin, shared wrapper around the Anthropic SDK for the app's optional AI features (workout coach,
// weekly digest, peptide adherence insights). Mirrors the barcode route's philosophy for external
// calls: server-side only, degrade gracefully on any failure rather than surfacing a 500, and let each
// feature's own repository cache the result so repeat views never re-call the API.
//
// Not configured (no ANTHROPIC_API_KEY) is a supported, first-class state, not an error — callers use
// aiAvailable() to render a "not configured" UI instead of attempting a call.

import Anthropic from '@anthropic-ai/sdk';
import { env } from '$env/dynamic/private';

/** Real coaching judgment (progressive-overload calls, muscle-balance reasoning) — worth the stronger tier. */
export const AI_MODEL_SONNET = 'claude-sonnet-5';
/** Mechanical summarization over well-defined structured input — cheapest capable tier. */
export const AI_MODEL_HAIKU = 'claude-haiku-4-5';

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

/** Single non-streaming text generation. Returns null on any failure (missing key, network error,
 *  API error, empty/non-text response) — callers degrade gracefully, same shape as the barcode route's
 *  try/catch-and-degrade. No thinking config is passed: Sonnet 5 runs adaptive thinking automatically
 *  when omitted (fine for the coaching feature's reasoning), and Haiku 4.5 has no adaptive mode and
 *  simply runs without thinking (fine for pure summarization). */
export async function generateText(opts: {
	model: string;
	system: string;
	prompt: string;
	maxTokens: number;
}): Promise<{ text: string; model: string } | null> {
	const c = getClient();
	if (!c) return null;
	try {
		const res = await c.messages.create({
			model: opts.model,
			max_tokens: opts.maxTokens,
			system: opts.system,
			messages: [{ role: 'user', content: opts.prompt }]
		});
		const block = res.content.find((b) => b.type === 'text');
		if (!block || block.type !== 'text') return null;
		return { text: block.text, model: res.model };
	} catch (err) {
		console.error('AI generateText failed', err);
		return null;
	}
}
