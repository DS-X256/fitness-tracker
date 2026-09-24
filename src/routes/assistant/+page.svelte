<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount } from 'svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import ChatText from '$lib/components/ai/ChatText.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Msg = { role: 'user' | 'assistant'; content: string };

	let messages = $state<Msg[]>(data.messages.map((m) => ({ role: m.role, content: m.content })));
	let input = $state('');
	let streaming = $state(false);
	let liveText = $state('');
	let liveThinking = $state('');
	let toolStatus = $state('');
	let error = $state('');
	let scrollEl = $state<HTMLElement | null>(null);
	let shareFeedback = $state<{ index: number; text: string } | null>(null);
	let shareFeedbackTimer: ReturnType<typeof setTimeout> | undefined;

	const canShare = typeof navigator !== 'undefined' && typeof navigator.share === 'function';

	/** Shares one assistant answer (paired with the question that prompted it, when there is one) via the
	 *  OS share sheet on mobile, or copies to the clipboard on desktop/unsupported browsers. Local only —
	 *  no server round-trip, so it doesn't touch how chat content is stored or who can read it. */
	async function shareMessage(index: number) {
		const answer = messages[index];
		if (!answer || answer.role !== 'assistant') return;
		const question = messages[index - 1];
		const text =
			question?.role === 'user'
				? `Q: ${question.content}\n\nA: ${answer.content}`
				: answer.content;

		if (canShare) {
			try {
				await navigator.share({ title: 'AI Coach · Fitness Tracker', text });
				return;
			} catch (err) {
				// User cancelling the share sheet throws AbortError — not a failure, don't fall back.
				if (err instanceof Error && err.name === 'AbortError') return;
			}
		}

		try {
			await navigator.clipboard.writeText(text);
			flashShareFeedback(index, 'Copied to clipboard');
		} catch {
			flashShareFeedback(index, "Couldn't share this message");
		}
	}

	function flashShareFeedback(index: number, text: string) {
		clearTimeout(shareFeedbackTimer);
		shareFeedback = { index, text };
		shareFeedbackTimer = setTimeout(() => (shareFeedback = null), 2000);
	}

	const SUGGESTIONS = [
		'How has my training volume looked this week?',
		'Am I hitting my protein target?',
		'What does the evidence actually say about the peptides I’m taking?',
		'Looking at my dose log and side effects, what might be going on?'
	];

	// Whether the viewport is pinned to the bottom — tracked continuously from real scroll events rather
	// than recomputed on every streamed token, so a burst of token events (many per second) never races
	// itself: each one used to snapshot "near bottom?", await a tick, then scroll, and with several of
	// those in flight at once an earlier one could resolve after a later one and snap the scroll position
	// backward — the "follows late and glitches" symptom. `autoScrolling` ignores the scroll events our
	// own scrollTo triggers, so they don't get mistaken for the user manually scrolling up.
	let pinnedToBottom = true;
	let autoScrolling = false;
	let scrollFrame = 0;

	function onScroll() {
		if (autoScrolling || !scrollEl) return;
		pinnedToBottom = scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
	}

	/** Stick to the bottom as content streams in — but only if the user is already pinned there, so
	 *  scrolling up to re-read earlier messages isn't yanked back down. `force` overrides that (used when
	 *  the user sends, so their own message always scrolls into view). Coalesces to at most one scroll per
	 *  animation frame no matter how many times it's called in between, so it always acts on the latest
	 *  content instead of stacking up stale scrolls. */
	function scrollToBottom(force = false) {
		if (force) pinnedToBottom = true;
		if (!pinnedToBottom || scrollFrame) return;
		scrollFrame = requestAnimationFrame(() => {
			scrollFrame = 0;
			if (!scrollEl || !pinnedToBottom) return;
			autoScrolling = true;
			scrollEl.scrollTo({ top: scrollEl.scrollHeight });
			requestAnimationFrame(() => (autoScrolling = false));
		});
	}

	function handleEvent(ev: { type: string; text?: string; label?: string; message?: string }) {
		if (ev.type === 'token') {
			toolStatus = '';
			liveThinking = '';
			liveText += ev.text ?? '';
		} else if (ev.type === 'thinking') {
			liveThinking += ev.text ?? '';
		} else if (ev.type === 'tool') {
			toolStatus = ev.label ?? '';
		} else if (ev.type === 'done') {
			if (liveText.trim()) messages = [...messages, { role: 'assistant', content: liveText.trim() }];
			liveText = '';
			liveThinking = '';
			toolStatus = '';
			streaming = false;
		} else if (ev.type === 'error') {
			error = ev.message ?? 'The AI Coach request failed.';
			liveText = '';
			liveThinking = '';
			toolStatus = '';
			streaming = false;
		}
		scrollToBottom();
	}

	async function send(text: string) {
		text = text.trim();
		if (!text || streaming) return;
		messages = [...messages, { role: 'user', content: text }];
		input = '';
		streaming = true;
		liveText = '';
		liveThinking = '';
		toolStatus = '';
		error = '';
		scrollToBottom(true);

		try {
			const res = await fetch('/api/assistant/chat', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ message: text })
			});
			if (!res.ok || !res.body) {
				error = 'The AI Coach request failed. Try again.';
				streaming = false;
				return;
			}
			const reader = res.body.getReader();
			const decoder = new TextDecoder();
			let buffer = '';
			for (;;) {
				const { done, value } = await reader.read();
				if (done) break;
				buffer += decoder.decode(value, { stream: true });
				let nl: number;
				while ((nl = buffer.indexOf('\n')) >= 0) {
					const line = buffer.slice(0, nl).trim();
					buffer = buffer.slice(nl + 1);
					if (line) handleEvent(JSON.parse(line));
				}
			}
			const rest = buffer.trim();
			if (rest) handleEvent(JSON.parse(rest));
		} catch {
			error = 'The AI Coach request failed. Try again.';
		} finally {
			// If the stream ended without an explicit done/error, keep whatever streamed in.
			if (streaming) {
				if (liveText.trim()) messages = [...messages, { role: 'assistant', content: liveText.trim() }];
				liveText = '';
				liveThinking = '';
				toolStatus = '';
				streaming = false;
			}
		}
	}

	// Open on the latest message, like any chat. A `?q=` link (e.g. "Ask the coach about this" on the
	// peptide recap) prefills the box — never auto-sends, so the user can edit before spending a request.
	onMount(() => {
		const q = new URL(window.location.href).searchParams.get('q');
		if (q && !input) input = q.slice(0, 2000);
		scrollToBottom(true);
	});

	function onKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' && !e.shiftKey) {
			e.preventDefault();
			send(input);
		}
	}
</script>

<svelte:head><title>AI Coach · Fitness Tracker</title></svelte:head>

<PageHeader title="AI Coach">
	{#snippet actions()}
		{#if data.aiAvailable && data.assistantEnabled && messages.length > 0}
			<form
				method="POST"
				action="?/clearChat"
				use:enhance={() => {
					return async ({ update }) => {
						messages = [];
						liveText = '';
						error = '';
						await update({ reset: false });
					};
				}}
			>
				<button
					type="submit"
					aria-label="New chat"
					disabled={streaming}
					class="h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)] disabled:opacity-50"
				>
					<Icon name="edit" size={18} />
				</button>
			</form>
		{/if}
	{/snippet}
</PageHeader>

{#if !data.aiAvailable}
	<div class="mx-auto max-w-md px-4 pb-4">
		<Card>
			<div class="flex items-start gap-3">
				<div class="mt-0.5 shrink-0 text-[var(--color-text-muted)]"><Icon name="sparkles" size={20} /></div>
				<div class="text-sm text-[var(--color-text)] leading-relaxed">
					<p class="font-medium">AI Coach isn't configured</p>
					<p class="mt-1 text-[var(--color-text-muted)]">
						The AI features need <code class="text-xs">ANTHROPIC_API_KEY</code> set on the server. Set it and restart to use the coach.
					</p>
				</div>
			</div>
		</Card>
	</div>
{:else if !data.assistantEnabled}
	<div class="mx-auto max-w-md px-4 pb-4 space-y-4">
		<Card>
			<div class="flex items-center gap-1.5 text-[0.6875rem] font-semibold uppercase tracking-[0.09em] text-[var(--color-accent)] mb-2">
				<Icon name="sparkles" size={14} />
				AI Coach
			</div>
			<p class="text-sm text-[var(--color-text)] leading-relaxed">
				Ask free-form questions about your nutrition, training, body, and peptide protocols. The coach reads your
				own logged data on demand to answer.
			</p>
			<p class="mt-2 text-[0.6875rem] leading-relaxed text-[var(--color-text-muted)]">
				When enabled, the data a question touches — meals, workouts, body metrics, and peptide logs (compound names,
				doses, schedules, and for dose-level questions your dose notes and side-effect check-ins) — is sent to
				Anthropic's Claude API to generate answers. Evidence questions can trigger live lookups against NCBI/PubMed and
				ClinicalTrials.gov, and web searches run by Anthropic — those only ever carry search terms like a compound
				name, never your doses, schedule, or other personal data. Off by default. The coach reasons and gives labelled
				estimates from evidence; it's not medical advice — involve a clinician for medical decisions.
			</p>
			<form method="POST" action="?/toggleAssistant" use:enhance class="mt-3">
				<input type="hidden" name="enabled" value="true" />
				<Button type="submit" variant="primary" size="md">
					<Icon name="sparkles" size={16} />
					Turn on AI Coach
				</Button>
			</form>
		</Card>
	</div>
{:else}
	<div class="mx-auto flex w-full max-w-md flex-1 flex-col min-h-0">
		<div bind:this={scrollEl} onscroll={onScroll} class="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
			{#if messages.length === 0 && !streaming}
				<div class="pt-6 space-y-4">
					<div class="text-center space-y-1.5">
						<div class="mx-auto flex h-11 w-11 items-center justify-center rounded-full bg-[var(--color-surface-alt)] text-[var(--color-accent)]">
							<Icon name="sparkles" size={22} />
						</div>
						<p class="text-sm text-[var(--color-text-muted)]">Ask your coach anything about your training, diet, body, or peptides.</p>
					</div>
					<div class="space-y-2">
						{#each SUGGESTIONS as s (s)}
							<button
								type="button"
								onclick={() => send(s)}
								class="w-full rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-left text-sm text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]"
							>
								{s}
							</button>
						{/each}
					</div>
				</div>
			{/if}

			{#each messages as msg, i (i)}
				{#if msg.role === 'user'}
					<div class="flex justify-end">
						<div class="max-w-[85%] rounded-[var(--radius-lg)] bg-[var(--color-accent)] px-3.5 py-2 text-[15px] text-[var(--color-on-accent)] whitespace-pre-line">
							{msg.content}
						</div>
					</div>
				{:else}
					<div class="flex flex-col items-start gap-1">
						<div class="max-w-[90%] rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] px-3.5 py-2 text-[15px] text-[var(--color-text)] whitespace-pre-line">
							<ChatText text={msg.content} />
						</div>
						<div class="flex items-center gap-2 px-1">
							<button
								type="button"
								onclick={() => shareMessage(i)}
								class="flex items-center gap-1 text-[0.6875rem] text-[var(--color-text-muted)] hover:text-[var(--color-text)]"
							>
								<Icon name="share" size={12} />
								Share
							</button>
							{#if shareFeedback?.index === i}
								<span class="text-[0.6875rem] text-[var(--color-text-muted)]">{shareFeedback.text}</span>
							{/if}
						</div>
					</div>
				{/if}
			{/each}

			{#if streaming}
				<div class="flex justify-start">
					<div class="max-w-[90%] rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] px-3.5 py-2 text-[15px] text-[var(--color-text)] whitespace-pre-line">
						{#if liveThinking && !liveText}
							<p class="text-[13px] italic text-[var(--color-text-muted)]">{liveThinking}</p>
						{/if}
						{#if liveText}<ChatText text={liveText} />{/if}{#if toolStatus}<span class="{liveText || liveThinking ? 'mt-1.5 ' : ''}block text-[var(--color-text-muted)]">{toolStatus}</span>{:else if !liveText && !liveThinking}<span class="text-[var(--color-text-muted)]">Thinking…</span>{/if}
					</div>
				</div>
			{/if}

			{#if error}
				<p class="text-xs text-[var(--color-danger)] px-1">{error}</p>
			{/if}
		</div>

		<div class="shrink-0 border-t border-[var(--color-border)] bg-[var(--color-bg)] px-4 py-3">
			<div class="flex items-end gap-2">
				<textarea
					bind:value={input}
					onkeydown={onKeydown}
					rows="1"
					placeholder="Ask your coach…"
					class="flex-1 resize-none max-h-32 rounded-[var(--radius-md)] border border-[var(--color-border)] bg-[var(--color-surface)] px-3.5 py-2.5 text-[15px] text-[var(--color-text)] placeholder:text-[var(--color-text-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
				></textarea>
				<Button variant="primary" size="icon" disabled={streaming || !input.trim()} onclick={() => send(input)}>
					<Icon name="sparkles" size={18} />
				</Button>
			</div>
			<p class="mt-1.5 text-[0.625rem] leading-relaxed text-[var(--color-text-muted)]">
				Reasoned from your data and the literature, with estimates labelled — not medical advice.
			</p>
		</div>
	</div>
{/if}
