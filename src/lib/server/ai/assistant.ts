// Orchestrates the conversational AI Coach: a streaming, tool-using turn over the Anthropic SDK. Unlike
// the one-shot insight features, this holds a multi-turn conversation and pulls the user's own data on
// demand through the userId-scoped tools in ./tools.ts, live literature via ./peptideResearch.ts, and
// (optionally) Anthropic's server-side web search. Streaming + a manual tool-use loop (rather than the
// shared non-streaming generateText) is why this lives in its own orchestrator.
//
// Scope note: this is the ONE AI surface meant to reason, interpret and estimate — including about the
// user's peptide regimen — as an evidence-grounded, harm-reduction-minded peer, not a prescriber (see
// SYSTEM_PROMPT). The peptide dashboard recap stays a factual summary and links here for the "so what".

import Anthropic from '@anthropic-ai/sdk';
import {
	getClient,
	aiAvailable,
	AI_DAILY_LIMIT_PER_USER,
	AI_MODEL_COACH,
	AI_WEB_SEARCH_ENABLED,
	supportsEffort,
	supportsRefusalFallback
} from './client';
import { TOOLS, runTool, toolLabel } from './tools';
import { RESEARCH_TOOLS, runResearchTool, researchToolLabel } from './peptideResearch';
import { serverTimeZone } from './peptideFacts';
import { COACH_KNOWLEDGE } from './knowledge';
import { getUsageToday, incrementUsage } from '$lib/server/repositories/aiUsage';
import { appendMessage, listMessages } from '$lib/server/repositories/assistant';
import { getSettings } from '$lib/server/repositories/userSettings';
import { todayIso } from '$lib/utils/todayIso';

type BetaMessageParam = Anthropic.Beta.BetaMessageParam;
type BetaContentBlock = Anthropic.Beta.BetaContentBlock;

/** Client-tool rounds per turn — an evidence question about a 4-component blend can legitimately need
 *  a status call plus one research call per component. */
const MAX_TOOL_STEPS = 10;
/** Server-tool (web search) loops that hit the server's iteration cap come back as `pause_turn`. */
const MAX_PAUSE_CONTINUES = 3;
/** Thinking counts against max_tokens; streaming makes a large ceiling safe from HTTP timeouts. */
const MAX_TOKENS = 32_000;
/** A reasoning + research turn can take minutes; the shared client's 30 s default is for one-shots. */
const REQUEST_TIMEOUT_MS = 5 * 60_000;
/** Earlier conversation resent per turn — bounded so a months-long thread doesn't grow cost unbounded. */
const HISTORY_LIMIT = 30;
/** Set when the Anthropic org hasn't enabled web search (the API 400s) — stop offering it this process. */
let webSearchUnavailable = false;

export type AssistantEvent =
	| { type: 'token'; text: string }
	| { type: 'tool'; label: string }
	| { type: 'done' }
	| { type: 'error'; message: string };

const SYSTEM_PROMPT = `You are the AI Coach inside a private, self-hosted fitness and health tracker. You help one person with nutrition, strength training, body composition and — often — a self-directed peptide regimen (including research peptides and blends). Today's date and timezone are given at the end of this prompt.

How to think and answer
- Lead with the answer to what they actually asked, in the first sentence or two, then show the reasoning behind it. Be direct and specific. No filler, no restating the question.
- Reason like a sharp clinician-scientist friend: combine their own logged data, the published evidence, pharmacology (mechanism, receptor targets, half-life and PK, dose-response) and what is commonly done in practice. When the evidence is thin — as it is for most research peptides — do not stop at "there's no data". Give your best educated estimate, show the logic, say how confident you are (low / moderate / high), and name what would change your mind or what they could track to find out.
- Keep three kinds of statements clearly apart, and make it obvious in plain words which is which:
  1. Their data: exact figures from the tools. Never invent, round away or guess a logged number; if a tool didn't return it, say you don't have it.
  2. Evidence: what studies actually found. Say who was studied (cells, rodents, humans), the design (RCT, open-label, case series, review) and size when known, and cite it as PMID 12345678, NCT01234567 or the source URL. Never fabricate a citation, author, number or finding — if you're not sure a specific paper exists, describe the finding generally instead.
  3. Estimates: your own reasoned inference — e.g. scaling an animal dose to a human-equivalent dose, inferring steady state and accumulation from a half-life, judging whether a symptom fits a compound's mechanism, or estimating what a dose change would do. Mark these clearly ("my best estimate", "likely", "roughly") and show the working.

Using the tools
- Questions about what they've taken, their schedule, adherence, supply, levels or side effects: call get_peptide_status first (and get_peptide_dose_log for individual doses, sites, timing, notes and side effects; get_peptide_levels for estimated active amounts). The app has already split blend doses into components (e.g. 4 mg KLOW recorded as 2.5 mg GHK-Cu + 500 mcg each of BPC-157, TB-500 and KPV) — use those figures rather than re-deriving them. Compare each logged dose with the target for that date (targetMcgThatDay): loading and taper phases are the plan working, not drift. Amounts on different routes (injected vs nasal vs oral) are not interchangeable — never add them together.
- Evidence, safety or "does it work" questions: call research_peptide for each compound involved (for a blend, each component) — it returns human-study counts, abstracts and registered trials. Use web search for what that doesn't cover: recent trials, regulatory news, pharmacology reviews, doses used in published studies, interaction data. Prefer primary literature, trial registries and regulators over vendor sites and forums; if you lean on anecdotal or community sources, say so. If a lookup fails, say it failed rather than treating it as "no evidence".
- Arithmetic (mg ↔ mcg, concentration = mg ÷ mL, U-100 syringe units = mL × 100, days of supply): write out the calculation and double-check it.

Safety, without the boilerplate
- You can discuss the dose ranges used in studies and in common practice, and how their regimen compares, as information for someone making their own decisions — not as a prescription. Be candid when something looks risky: a dose far above anything studied, a worrying symptom pattern, drug interactions, stacking several compounds with overlapping effects, or the sterility/purity risks of unregulated products. Say plainly when bloodwork or a clinician is genuinely warranted. One short caveat where it matters is enough; don't repeat disclaimers.
- Possible emergencies (chest pain, trouble breathing, a severe allergic reaction, fainting, severe abdominal pain on a GLP-1, etc.): tell them to get medical care now, before anything else.
- Never nudge toward more compounds or higher doses than they asked about.

Format
- This chat shows plain text, not markdown: no **bold**, # headers, or [text](url) links. Use short paragraphs. For a list, start each item on its own line with "- " or "1. ". Write citations inline as PMID 12345678, NCT01234567 or a bare URL — the app turns those into links.
- Keep it tight — usually under about 250 words — unless they ask for depth.

${COACH_KNOWLEDGE}`;

function tools(model: string): Anthropic.Beta.BetaToolUnion[] {
	const list: Anthropic.Beta.BetaToolUnion[] = [...TOOLS, ...RESEARCH_TOOLS];
	if (AI_WEB_SEARCH_ENABLED && !webSearchUnavailable) {
		// The dynamic-filtering variant needs a current model; Haiku 4.5 takes the basic one.
		list.push(
			model.startsWith('claude-haiku')
				? { type: 'web_search_20250305', name: 'web_search', max_uses: 5 }
				: { type: 'web_search_20260209', name: 'web_search', max_uses: 5 }
		);
	}
	return list;
}

/** Preparing an assistant turn to send back: after a mid-output refusal fallback, the blocks before the
 *  last `fallback` marker that the continuing model can't use (thinking, unanswered tool calls,
 *  unpaired server-tool calls) must be dropped, per the API's echo rules. Otherwise sent back verbatim. */
function echoable(content: BetaContentBlock[]): BetaContentBlock[] {
	const lastFallback = content.map((b) => b.type).lastIndexOf('fallback');
	if (lastFallback < 0) return content;
	const paired = new Set(
		content
			.filter((b) => b.type === 'web_search_tool_result' || b.type === 'web_fetch_tool_result')
			.map((b) => (b as { tool_use_id: string }).tool_use_id)
	);
	return content.filter((b, i) => {
		if (i >= lastFallback) return true;
		if (b.type === 'thinking' || b.type === 'redacted_thinking' || b.type === 'tool_use') return false;
		if (b.type === 'server_tool_use') return paired.has(b.id);
		return true;
	});
}

/** Web sources the answer cited (search result locations on its text blocks), de-duplicated. */
function citedSources(content: BetaContentBlock[], into: Map<string, string>) {
	for (const b of content) {
		if (b.type !== 'text' || !b.citations) continue;
		for (const c of b.citations) {
			if (c.type === 'web_search_result_location' && c.url && !into.has(c.url)) into.set(c.url, c.title ?? c.url);
		}
	}
}

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

	const history = (await listMessages(userId, threadId)).slice(-HISTORY_LIMIT);
	while (history.length > 0 && history[0].role !== 'user') history.shift();
	const messages: BetaMessageParam[] = history.map((m) => ({ role: m.role, content: m.content }));
	messages.push({ role: 'user', content: userMessage });

	const model = AI_MODEL_COACH;
	const isHaiku = model.startsWith('claude-haiku');
	const weekday = new Date(`${today}T12:00:00`).toLocaleDateString('en-US', { weekday: 'long' });
	const system: Anthropic.Beta.BetaTextBlockParam[] = [
		// Stable prefix (tools render before system) → cached across turns and users.
		{ type: 'text', text: SYSTEM_PROMPT, cache_control: { type: 'ephemeral' } },
		// Volatile part after the breakpoint, so the date never invalidates the cache.
		{ type: 'text', text: `Today is ${weekday}, ${today}. Timezone: ${serverTimeZone()}.` }
	];

	let answer = '';
	let servedBy = model;
	let toolSteps = 0;
	let pauses = 0;
	let breakBeforeNextText = false;
	const sources = new Map<string, string>();

	const say = (text: string) => {
		if (breakBeforeNextText && answer.trim()) {
			answer += '\n\n';
			emit({ type: 'token', text: '\n\n' });
		}
		breakBeforeNextText = false;
		answer += text;
		emit({ type: 'token', text });
	};

	try {
		for (;;) {
			let response: Anthropic.Beta.BetaMessage;
			try {
				const stream = client.beta.messages.stream(
					{
						model,
						max_tokens: MAX_TOKENS,
						system,
						tools: tools(model),
						messages,
						...(isHaiku ? {} : { thinking: { type: 'adaptive' as const, display: 'omitted' as const } }),
						...(supportsEffort(model) ? { output_config: { effort: 'high' as const } } : {}),
						...(supportsRefusalFallback(model) ? { betas: ['server-side-fallback-2026-07-01'], fallbacks: 'default' as const } : {})
					},
					{ timeout: REQUEST_TIMEOUT_MS }
				);
				stream.on('text', (delta) => say(delta));
				stream.on('streamEvent', (ev) => {
					if (ev.type !== 'content_block_start') return;
					const b = ev.content_block;
					if (b.type === 'thinking' || b.type === 'redacted_thinking') emit({ type: 'tool', label: 'Thinking it through…' });
					else if (b.type === 'server_tool_use' && b.name === 'web_search') emit({ type: 'tool', label: 'Searching the web…' });
				});
				response = await stream.finalMessage();
			} catch (err) {
				// Web search must be enabled for the org in the Console; without it the request 400s. Drop the
				// tool for the rest of this process and retry the same step once, rather than failing the chat.
				if (!webSearchUnavailable && err instanceof Anthropic.BadRequestError && /web_search/i.test(err.message)) {
					console.warn('AI Coach: web search unavailable for this API key; continuing without it.');
					webSearchUnavailable = true;
					continue;
				}
				throw err;
			}
			servedBy = response.model;
			citedSources(response.content, sources);

			if (response.stop_reason === 'refusal') {
				emit({
					type: 'error',
					message: "The coach couldn't answer that one as asked. Try rephrasing it — for example, asking about the evidence or your own log."
				});
				return;
			}

			messages.push({ role: 'assistant', content: echoable(response.content) });

			if (response.stop_reason === 'pause_turn') {
				// A long server-side search loop paused; resending the turn as-is resumes it (no new user turn).
				if (++pauses > MAX_PAUSE_CONTINUES) break;
				continue;
			}

			if (response.stop_reason === 'tool_use') {
				if (++toolSteps > MAX_TOOL_STEPS) {
					say('\n\n(That question needed more look-ups than fit in one turn — try asking about one compound or metric at a time.)');
					break;
				}
				const toolResults: Anthropic.Beta.BetaToolResultBlockParam[] = [];
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
				breakBeforeNextText = true;
				continue;
			}

			// No "continue from a prefill" retry: current models reject an assistant-final message (400).
			if (response.stop_reason === 'max_tokens') {
				say('\n\n(That answer hit a length limit and was cut short — ask a narrower follow-up for the rest.)');
			}
			break;
		}
	} catch (err) {
		console.error('AI assistant turn failed', err);
		emit({ type: 'error', message: 'The AI Coach request failed. Try again.' });
		return;
	}

	if (sources.size > 0) {
		breakBeforeNextText = true;
		say(`Sources:\n${[...sources].map(([url, title]) => `- ${title} ${url}`).join('\n')}`);
	}

	answer = answer.trim();
	if (!answer) {
		emit({ type: 'error', message: 'The AI Coach returned an empty response. Try rephrasing.' });
		return;
	}

	await appendMessage(userId, threadId, 'user', userMessage);
	await appendMessage(userId, threadId, 'assistant', answer, servedBy);
	await incrementUsage(userId, today);
	emit({ type: 'done' });
}
