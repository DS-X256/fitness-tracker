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
import { RESEARCH_TOOLS, runResearchTool, researchToolLabel } from './peptideResearch';
import { COACH_KNOWLEDGE } from './knowledge';
import { getUsageToday, incrementUsage } from '$lib/server/repositories/aiUsage';
import { appendMessage, listMessages } from '$lib/server/repositories/assistant';
import { getSettings } from '$lib/server/repositories/userSettings';
import { todayIso } from '$lib/utils/todayIso';

const MAX_TOOL_STEPS = 6;
const MAX_TOKENS = 4096;
/** Extra API calls purely to finish a reply that hit MAX_TOKENS mid-sentence — separate from
 *  MAX_TOOL_STEPS so a tool-heavy turn and a long-answer turn don't compete for the same budget.
 *  Each continuation resends `messages` with the previous (truncated) assistant turn still as the
 *  last entry, which the API treats as a prefill and continues generating from — no new user turn
 *  needed, so the streamed answer just keeps extending seamlessly. */
const MAX_CONTINUATIONS = 2;

/** The userId-scoped data tools plus the stateless external research tool(s), combined once here so
 *  tools.ts can stay scoped to its own doc comment ("thin wrappers over existing repositories, no new
 *  query logic") and peptideResearch.ts can stay scoped to its (external HTTP, no userId anywhere). */
const ALL_TOOLS: Anthropic.Tool[] = [...TOOLS, ...RESEARCH_TOOLS];

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
- Write plain text only — no markdown formatting at all (no **bold**, *italics*, # headers, - / * bullet lists, or [links](url)). This chat renders your reply as literal text, so markdown syntax shows up as stray asterisks, hashes, and brackets instead of formatting. Use plain sentences and, if you need a list, write it as a short run-in sentence or separate lines of plain text, not bullet characters.
- When you state a peptide dose the user has logged, use the actual logged amounts (loggedDoseMcgValues — an array of {date, doseMcg} entries, oldest to newest), not the protocol's target — read the array in that given order rather than reversing it, and you may point out when logged amounts drift from the protocol.

Peptide research grounding:
- For any question about a specific compound's current evidence, proof, legitimacy, trial status, or safety data ("is X proven", "what's the human evidence for X", "is X's safety data solid", "what trials exist for X"), call research_peptide with that compound name before answering — prefer its live results over the general background knowledge below, which can go stale in a fast-moving space.
- The reference knowledge below still covers mechanism-of-action, general dosing practice, and harm-reduction basics — you don't need to call research_peptide for those unless the user is specifically asking about evidence strength, proof, or trial/approval status.
- When you cite a result from research_peptide, cite it plainly in prose as "PMID <number>" or "NCT<number>" — plain text, not a markdown link or bracketed citation; this chat does not render links or markdown, so anything else shows up as literal punctuation. State the evidence tier in plain language (e.g. "human trials exist" vs. "animal studies only" vs. "FDA-approved") rather than just listing citations without characterizing them.
- If research_peptide reports a source as unavailable or timed out, say so briefly rather than treating silence as a negative result — a failed lookup is not the same as "no evidence exists".

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
	let toolSteps = 0;
	let continuations = 0;
	try {
		for (;;) {
			const stream = client.messages.stream({
				model: AI_MODEL_SONNET,
				max_tokens: MAX_TOKENS,
				system: SYSTEM_PROMPT,
				tools: ALL_TOOLS,
				messages
			});
			stream.on('text', (delta) => {
				answer += delta;
				emit({ type: 'token', text: delta });
			});
			const response = await stream.finalMessage();
			model = response.model;
			messages.push({ role: 'assistant', content: response.content });

			if (response.stop_reason === 'tool_use') {
				if (++toolSteps > MAX_TOOL_STEPS) break;
				const toolResults: Anthropic.ToolResultBlockParam[] = [];
				for (const block of response.content) {
					if (block.type !== 'tool_use') continue;
					const isResearchTool = RESEARCH_TOOLS.some((t) => t.name === block.name);
					emit({ type: 'tool', label: isResearchTool ? researchToolLabel(block.name) : toolLabel(block.name) });
					const content = isResearchTool
						? await runResearchTool(block.name, block.input as Record<string, unknown>)
						: await runTool(userId, block.name, block.input as Record<string, unknown>);
					toolResults.push({ type: 'tool_result', tool_use_id: block.id, content });
				}
				messages.push({ role: 'user', content: toolResults });
				continue;
			}

			// Hit the length cap mid-reply rather than finishing naturally — resend `messages` as-is (it
			// already ends with this truncated assistant turn) so the API continues it as a prefill,
			// instead of silently handing back a sentence cut off in the middle.
			if (response.stop_reason === 'max_tokens' && continuations < MAX_CONTINUATIONS) {
				continuations++;
				emit({ type: 'tool', label: 'Continuing a longer answer…' });
				continue;
			}
			if (response.stop_reason === 'max_tokens') {
				const note = '\n\n(That answer hit a length limit and was cut short — ask again, or ask a narrower question, for the rest.)';
				answer += note;
				emit({ type: 'token', text: note });
			}
			break;
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
