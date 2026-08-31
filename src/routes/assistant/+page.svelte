<script lang="ts">
	import { enhance } from '$app/forms';
	import { onMount, tick } from 'svelte';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Msg = { role: 'user' | 'assistant'; content: string };

	let messages = $state<Msg[]>(data.messages.map((m) => ({ role: m.role, content: m.content })));
	let input = $state('');
	let streaming = $state(false);
	let liveText = $state('');
	let toolStatus = $state('');
	let error = $state('');
	let scrollEl = $state<HTMLElement | null>(null);

	const SUGGESTIONS = [
		'How has my training volume looked this week?',
		'Am I hitting my protein target?',
		'Is my weight trending toward my goal?',
		'Are my logged peptide doses matching my protocol?'
	];

	function isNearBottom(): boolean {
		if (!scrollEl) return true;
		return scrollEl.scrollHeight - scrollEl.scrollTop - scrollEl.clientHeight < 80;
	}

	/** Stick to the bottom as content streams in — but only if the user is already near the bottom, so
	 *  scrolling up to re-read earlier messages isn't yanked back down. `force` overrides that (used when
	 *  the user sends, so their own message always scrolls into view). Checks position before the DOM
	 *  grows, then scrolls after. */
	async function scrollToBottom(force = false) {
		const near = isNearBottom();
		await tick();
		if (force || near) scrollEl?.scrollTo({ top: scrollEl.scrollHeight });
	}

	function handleEvent(ev: { type: string; text?: string; label?: string; message?: string }) {
		if (ev.type === 'token') {
			toolStatus = '';
			liveText += ev.text ?? '';
		} else if (ev.type === 'tool') {
			toolStatus = ev.label ?? '';
		} else if (ev.type === 'done') {
			if (liveText.trim()) messages = [...messages, { role: 'assistant', content: liveText.trim() }];
			liveText = '';
			toolStatus = '';
			streaming = false;
		} else if (ev.type === 'error') {
			error = ev.message ?? 'The AI Coach request failed.';
			liveText = '';
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
				toolStatus = '';
				streaming = false;
			}
		}
	}

	// Open on the latest message, like any chat.
	onMount(() => scrollToBottom(true));

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
				doses, schedules) — is sent to Anthropic's Claude API to generate answers. Questions about a specific peptide
				may also trigger a live lookup against NCBI/PubMed and ClinicalTrials.gov's public databases — only the
				compound name is sent to those, never your doses, schedule, or any other personal data. Off by default.
				Peptide guidance is educational only, not medical advice — discuss any protocol with a qualified clinician.
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
		<div bind:this={scrollEl} class="flex-1 min-h-0 overflow-y-auto px-4 py-4 space-y-3">
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
					<div class="flex justify-start">
						<div class="max-w-[90%] rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] px-3.5 py-2 text-[15px] text-[var(--color-text)] whitespace-pre-line">
							{msg.content}
						</div>
					</div>
				{/if}
			{/each}

			{#if streaming}
				<div class="flex justify-start">
					<div class="max-w-[90%] rounded-[var(--radius-lg)] bg-[var(--color-surface)] border border-[var(--color-border)] px-3.5 py-2 text-[15px] text-[var(--color-text)] whitespace-pre-line">
						{#if liveText}{liveText}{:else if toolStatus}<span class="text-[var(--color-text-muted)]">{toolStatus}</span>{:else}<span class="text-[var(--color-text-muted)]">Thinking…</span>{/if}
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
				Educational only, grounded in your logged data — not medical advice.
			</p>
		</div>
	</div>
{/if}
