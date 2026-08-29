// Orchestrates the conversational AI Coach: a streaming, tool-using turn over the Anthropic SDK. Unlike
// the three one-shot insight features, this holds a multi-turn conversation and pulls the user's own data
// on demand through the userId-scoped tools in ./tools.ts. Streaming + a manual tool-use loop (rather than
// the shared non-streaming generateText) is why this lives in its own orchestrator.
//
// Scope note: this is the ONE AI surface allowed to discuss personalized peptide dosing — but only as
// educational, harm-reduction framing that defers real medical decisions to a healthcare professional
// (see SYSTEM_PROMPT). It is a deliberate, private-deployment choice; it is not a licensed clinician and
// must not present authoritative prescriptions. The peptide *insight card* stays administrative-only.

import type Anthropic from '@anthropic-ai/sdk';
import { getClient, aiAvailable, AI_MODEL_SONNET, AI_DAILY_LIMIT_PER_USER } from './client';
import { TOOLS, runTool, toolLabel } from './tools';
import { COACH_KNOWLEDGE } from './knowledge';
import { getUsageToday, incrementUsage } from '$lib/server/repositories/aiUsage';
import { appendMessage, listMessages } from '$lib/server/repositories/assistant';
import { getSettings } from '$lib/server/repositories/userSettings';
import { todayIso } from '$lib/utils/todayIso';

const MAX_TOOL_STEPS = 6;
const MAX_TOKENS = 1536;

export type AssistantEvent =
	| { type: 'token'; text: string }
	| { type: 'tool'; label: string }
	| { type: 'done' }
	| { type: 'error'; message: string };

const SYSTEM_PROMPT = `You are the AI Coach inside a private, self-hosted personal fitness and health tracker used by a single person for their own data. You help with nutrition, strength training, body-composition, and peptide protocols.

Grounding rules:
- Answer from the user's actual logged data. Call the provided tools to fetch it before making any claim about their numbers — never guess or invent a figure, a date, a weight, a dose, or a trend that a tool didn't return.
- If the data needed isn't available (no tool covers it, or the tool returns empty), say so plainly instead of fabricating.
- Be concise and practical: a few short paragraphs, plain prose, no headers. Give specific, actionable coaching grounded in what you see.
- When you state a peptide dose the user has logged, use the actual logged amounts (loggedDoseMcgValues), not the protocol's target — and you may point out when logged amounts drift from the protocol.

Peptides — scope and framing:
- This is a private tool and you may discuss the user's peptide protocols in depth, including general dosing ranges, timing, reconstitution math, injection-site rotation, and harm-reduction practices, as education.
- Frame guidance as informational and educational, not as a prescription. You are not a licensed clinician and cannot diagnose or prescribe. For any actual decision to start, stop, or change a dose or compound — and for anything involving side effects, symptoms, interactions, or bloodwork — recommend consulting a qualified healthcare professional, and say so briefly rather than repeating it in every sentence.
- Prioritize safety: flag when logged doses drift from the user's own protocol, when a vial is expired or nearly empty, or when injection-site rotation looks neglected. Never pressure toward higher doses or more compounds.

Never present yourself as a substitute for medical care.

Using the reference knowledge below:
- It is background grounding on training/nutrition science and peptide pharmacology. Draw on it to give richer, more accurate answers, but always tie advice back to THIS user's logged data via the tools.
- Present specifics (rep ranges, protein targets, volume landmarks, dose practices) as general evidence-based ranges, not personalized prescriptions.
- Do NOT fabricate study citations, authors, journals, or statistics. Only the named references in the text below are real; if you are not certain a reference exists, describe the finding as general scientific consensus without attributing it to a specific paper.

${COACH_KNOWLEDGE}`;

/**
 * Runs one user turn: streams the assistant's reply (emitting token/tool/done/error events) and, on
 * success, persists both the user message and the assistant reply and counts one unit of daily quota.
 * A turn that never produces a successful reply consumes no quota and persists nothing.
 */
export async function runAssistantTurn(
	userId: number,
	threadId: number,
	userMessage: string,
	emit: (event: AssistantEvent) => void
): Promise<void> {
	const settings = await getSettings(userId);
	if (!settings.aiAssistantEnabled) {
		emit({ type: 'error', message: 'The AI Coach is turned off in settings.' });
		return;
	}
	const client = getClient();
	if (!client || !aiAvailable()) {
		emit({ type: 'error', message: 'AI features are not configured on this server.' });
		return;
	}

	const today = todayIso();
	if ((await getUsageToday(userId, today)) >= AI_DAILY_LIMIT_PER_USER) {
		emit({ type: 'error', message: `You've reached today's AI usage limit (${AI_DAILY_LIMIT_PER_USER} requests). Try again tomorrow.` });
		return;
	}

	const history = await listMessages(userId, threadId);
	const messages: Anthropic.MessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
	messages.push({ role: 'user', content: userMessage });

	let answer = '';
	let model = AI_MODEL_SONNET;
	try {
		for (let step = 0; step < MAX_TOOL_STEPS; step++) {
			const stream = client.messages.stream({
				model: AI_MODEL_SONNET,
				max_tokens: MAX_TOKENS,
				system: SYSTEM_PROMPT,
				tools: TOOLS,
				messages
			});
			stream.on('text', (delta) => {
				answer += delta;
				emit({ type: 'token', text: delta });
			});
			const response = await stream.finalMessage();
			model = response.model;
			messages.push({ role: 'assistant', content: response.content });

			if (response.stop_reason !== 'tool_use') break;

			const toolResults: Anthropic.ToolResultBlockParam[] = [];
			for (const block of response.content) {
				if (block.type !== 'tool_use') continue;
				emit({ type: 'tool', label: toolLabel(block.name) });
				const content = await runTool(userId, block.name, block.input as Record<string, unknown>);
				toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
			}
			messages.push({ role: 'user', content: toolResults });
		}
	} catch (err) {
		console.error('AI assistant turn failed', err);
		emit({ type: 'error', message: 'The AI Coach request failed. Try again.' });
		return;
	}

	answer = answer.trim();
	if (!answer) {
		emit({ type: 'error', message: 'The AI Coach returned an empty response. Try rephrasing.' });
		return;
	}

	await appendMessage(userId, threadId, 'user', userMessage);
	await appendMessage(userId, threadId, 'assistant', answer, model);
	await incrementUsage(userId, today);
	emit({ type: 'done' });
}
