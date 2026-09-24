<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import HealthNav from '$lib/components/HealthNav.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import AdherenceCalendar from '$lib/components/peptides/AdherenceCalendar.svelte';
	import LogDoseModal from '$lib/components/peptides/LogDoseModal.svelte';
	import DueTodayCard from '$lib/components/peptides/DueTodayCard.svelte';
	import DoseHistoryList from '$lib/components/peptides/DoseHistoryList.svelte';
	import SupplyAlerts from '$lib/components/peptides/SupplyAlerts.svelte';
	import LevelSparkline from '$lib/components/peptides/LevelSparkline.svelte';
	import AiInsightCard from '$lib/components/ai/AiInsightCard.svelte';
	import { formatHalfLife, formatLevel, ROUTE_LABELS } from '$lib/utils/peptides';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Ready = Extract<PageData, { encryptionReady: true }>;
	let logOpen = $state(false);
	let logInitial = $state<{ peptideId?: number; protocolId?: number | null; doseMcg?: number | null } | null>(null);
	let editingDose = $state<Ready['recent'][number] | null>(null);

	function openLog(initial: typeof logInitial = null) {
		logInitial = initial;
		editingDose = null;
		logOpen = true;
	}

	function openEdit(dose: Ready['recent'][number]) {
		editingDose = dose;
		logInitial = null;
		logOpen = true;
	}

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
</script>

<svelte:head><title>Peptides · Fitness Tracker</title></svelte:head>

<PageHeader title="Peptides">
	{#snippet actions()}
		<a
			href="/peptides/photos"
			aria-label="Progress photos"
			class="h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
		>
			<Icon name="camera" size={18} />
		</a>
		<a
			href="/peptides/levels"
			aria-label="Estimated levels in the body"
			title="Estimated levels"
			class="h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
		>
			<Icon name="chart" size={18} />
		</a>
		<a
			href="/peptides/manage"
			aria-label="Manage compounds, protocols & vials"
			class="h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
		>
			<Icon name="sliders" size={18} />
		</a>
	{/snippet}
</PageHeader>

<HealthNav />

{#if !data.encryptionReady}
	<div class="mx-auto max-w-md px-4 pb-4">
		<Card>
			<div class="flex items-start gap-3">
				<div class="mt-0.5 shrink-0 text-[var(--color-danger)]"><Icon name="alert" size={20} /></div>
				<div class="text-sm text-[var(--color-text)] leading-relaxed">
					<p class="font-medium">Encryption isn't configured</p>
					<p class="mt-1 text-[var(--color-text-muted)]">
						Peptide data is stored encrypted at rest, so this feature needs <code class="text-xs">PHOTO_ENCRYPTION_KEY</code>
						set (the same key that protects progress photos). Set it and restart to start tracking.
					</p>
				</div>
			</div>
		</Card>
	</div>
{:else}
	<div class="mx-auto max-w-md px-4 pb-4 space-y-5">
		<!-- Disclaimer — always visible, deliberately not dismissible. -->
		<div class="flex items-start gap-2.5 rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3.5 py-2.5">
			<div class="mt-0.5 shrink-0 text-[var(--color-text-muted)]"><Icon name="alert" size={16} /></div>
			<p class="text-xs leading-relaxed text-[var(--color-text-muted)]">
				A personal log for a regimen you already follow — not medical advice. Doses and schedules are the ones you
				enter. Discuss any protocol with a qualified clinician.
			</p>
		</div>

		<DueTodayCard
			rows={data.due}
			title={`Due today · ${fmtDate(data.today)}`}
			onAdjust={(row) => openLog({ peptideId: row.peptideId, protocolId: row.protocolId })}
		/>

		<Button variant="primary" size="lg" full class="w-full" onclick={() => openLog()}>
			<Icon name="plus" size={20} /> Log a dose
		</Button>

		<SupplyAlerts rows={data.supply} />

		<!-- Active in body — a rough decay estimate for compounds with a half-life, blends included. -->
		{#if data.activeLevels.length > 0}
			<div>
				<div class="flex items-center justify-between mb-2 px-1">
					<h2 class="section-label">Active in body</h2>
					<a href="/peptides/levels" class="flex items-center gap-0.5 text-sm font-medium text-[var(--color-accent)]">
						See levels <Icon name="chevron-right" size={16} />
					</a>
				</div>
				<Card padded={false} class="divide-y divide-[var(--color-border)]">
					{#each data.activeLevels as a (`${a.peptideId}|${a.route}`)}
						<a href={`/peptides/${a.peptideId}`} class="flex items-center gap-3 px-4 py-3">
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] truncate">
									{a.peptideName}{#if a.route}<span class="text-[var(--color-text-muted)] font-normal">{' · '}{ROUTE_LABELS[a.route]}</span>{/if}
								</p>
								<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
									~{formatHalfLife(a.halfLifeHours)} half-life{#if a.lastDoseDate}{' · '}last {fmtDate(a.lastDoseDate)}{/if}{#if a.viaBlend}{' · '}incl. blends{/if}
								</p>
							</div>
							<LevelSparkline doses={a.doses} halfLifeHours={a.halfLifeHours} nowMs={data.nowMs} label={a.peptideName} />
							<span class="w-16 shrink-0 text-right text-sm font-semibold text-[var(--color-text)] tabular-nums">{formatLevel(a.activeMcg)}</span>
						</a>
					{/each}
				</Card>
				<p class="mt-1.5 px-1 text-xs text-[var(--color-text-muted)]">
					A rough estimate from your logged doses and each compound's reference half-life — not a real PK model, and
					not dosing guidance.
				</p>
			</div>
		{/if}

		<!-- Adherence + calendar -->
		{#if data.adherence.totals.scheduled > 0}
			<Card>
				<div class="flex items-center justify-between mb-3">
					<h2 class="section-label">Adherence · {data.adherence.windowDays} days</h2>
					<span class="text-sm font-semibold text-[var(--color-text)] tabular-nums">{data.adherence.pct != null ? `${data.adherence.pct}%` : '—'}</span>
				</div>
				<AdherenceCalendar days={data.adherence.calendar} today={data.today} />
				<p class="mt-3 text-xs text-[var(--color-text-muted)] tabular-nums">
					{data.adherence.totals.taken} taken · {data.adherence.totals.missed} missed{#if data.adherence.totals.skipped}{' · '}{data.adherence.totals.skipped} skipped{/if}{#if data.adherence.totals.pending}{' · '}{data.adherence.totals.pending} still due{/if}
				</p>
			</Card>
		{/if}

		<!-- AI adherence insights — opt-in, off by default; see the toggle's own disclosure text. -->
		<AiInsightCard
			title="AI insights"
			disclosure="Sends your protocol adherence, what you took (blends split into components), supply and upcoming changes to Claude to generate this recap — never free-text notes or side effects."
			action="/peptides?/generatePeptideInsight"
			insight={data.peptideInsight}
			aiAvailable={data.aiAvailable}
			buttonLabel="Generate insight"
			disabled={!data.aiInsightsEnabled}
			disabledMessage="Turn on AI adherence insights above to generate a summary."
			extra={aiToggle}
			stale={data.insightStale}
			followUp={{
				href: `/assistant?q=${encodeURIComponent('Looking at my peptide log for the last 30 days — how am I doing, and is there anything I should pay attention to?')}`,
				label: 'Ask the coach about this'
			}}
		/>

		<!-- Recent history -->
		{#if data.recent.length > 0}
			<div>
				<h2 class="section-label mb-2 px-1">Recent doses</h2>
				<DoseHistoryList rows={data.recent} onEdit={openEdit} />
			</div>
		{/if}

		<!-- Empty state -->
		{#if !data.hasCompounds}
			<Card href="/peptides/manage">
				<div class="flex items-center gap-3 text-[var(--color-text-muted)]">
					<Icon name="vial" size={22} />
					<span class="text-sm">Add your compounds and set up a protocol to get started.</span>
				</div>
			</Card>
		{:else if data.due.length === 0 && data.recent.length === 0}
			<p class="text-center text-sm text-[var(--color-text-muted)] py-2">
				No doses due today. Tap “Log a dose” to record one, or
				<a href="/peptides/manage" class="text-[var(--color-accent)]">set up a protocol</a>.
			</p>
		{/if}
	</div>

	<LogDoseModal
		bind:open={logOpen}
		compounds={data.modal.compounds}
		protocols={data.modal.protocols}
		vials={data.modal.vials}
		recentSites={data.siteHistory}
		initial={logInitial}
		editing={editingDose}
	/>
{/if}

{#snippet aiToggle()}
	{#if data.encryptionReady}
		<form method="POST" action="?/toggleAiInsights" use:enhance>
			<input type="hidden" name="enabled" value={String(!data.aiInsightsEnabled)} />
			<button type="submit" class="flex w-full items-center justify-between gap-3 text-left">
				<span class="text-sm text-[var(--color-text)]">AI adherence insights</span>
				<span
					class={`relative h-6 w-11 shrink-0 rounded-full transition-colors ${data.aiInsightsEnabled ? 'bg-[var(--color-accent)]' : 'bg-[var(--color-surface-alt)]'}`}
					aria-hidden="true"
				>
					<span
						class={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-transform ${data.aiInsightsEnabled ? 'translate-x-[22px]' : 'translate-x-0.5'}`}
					></span>
				</span>
			</button>
		</form>
		<p class="text-[0.6875rem] text-[var(--color-text-muted)]">
			When enabled, your peptide log — compound names, doses, and schedule — is sent to Anthropic's Claude API to
			generate a plain-language recap. Off by default.
		</p>
	{/if}
{/snippet}
