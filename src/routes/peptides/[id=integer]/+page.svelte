<script lang="ts">
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Chip from '$lib/components/Chip.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import AdherenceCalendar from '$lib/components/peptides/AdherenceCalendar.svelte';
	import CompoundModal from '$lib/components/peptides/CompoundModal.svelte';
	import DoseHistoryList from '$lib/components/peptides/DoseHistoryList.svelte';
	import DueTodayCard from '$lib/components/peptides/DueTodayCard.svelte';
	import LevelChart from '$lib/components/peptides/LevelChart.svelte';
	import LogDoseModal from '$lib/components/peptides/LogDoseModal.svelte';
	import ProtocolModal from '$lib/components/peptides/ProtocolModal.svelte';
	import VialModal from '$lib/components/peptides/VialModal.svelte';
	import {
		CONTAINER_FORM_LABELS,
		MEASURE_UNIT_LABELS,
		ROUTE_LABELS,
		SEVERITY_LABELS,
		activeAmountMcg,
		blendRatioSummary,
		categoryLabel,
		effectLabel,
		formatDose,
		formatHalfLife,
		formatLevel,
		levelSeries
	} from '$lib/utils/peptides';
	import { daysBetween } from '$lib/utils/peptideSchedule';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();

	type Proto = PageData['protocols'][number];
	type HistoryRow = PageData['history'][number];

	let logOpen = $state(false);
	let logInitial = $state<{ peptideId?: number; protocolId?: number | null } | null>(null);
	let editingDose = $state<HistoryRow | null>(null);
	let compoundOpen = $state(false);
	let protocolOpen = $state(false);
	let editingProtocol = $state<Proto | null>(null);
	let vialOpen = $state(false);
	let editingVial = $state<PageData['vials'][number] | null>(null);

	function openLog(protocolId: number | null = null) {
		logInitial = { peptideId: data.compound.id, protocolId };
		editingDose = null;
		logOpen = true;
	}

	const DAY_MS = 86_400_000;
	let levelRoute = $state<string | null>(null);
	const level = $derived(data.levels.find((l) => (l.route ?? '') === levelRoute) ?? data.levels[0] ?? null);
	const levelFrom = $derived(data.nowMs - 30 * DAY_MS);
	const levelPoints = $derived(
		level && data.compound.halfLifeHours ? levelSeries(level.doses, data.compound.halfLifeHours, levelFrom, data.nowMs) : []
	);
	const activeNow = $derived(level && data.compound.halfLifeHours ? activeAmountMcg(level.doses, data.compound.halfLifeHours, new Date(data.nowMs)) : 0);

	function fmtDate(d: string) {
		return new Date(`${d}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
	}
	function relDays(d: string): string {
		const n = daysBetween(data.today, d);
		if (n === 0) return 'today';
		if (n === 1) return 'tomorrow';
		return n > 1 ? `in ${n} days` : `${-n} days ago`;
	}
	const CHANGE_LABEL = {
		loading_ends: 'Loading phase ends',
		taper_starts: 'Taper starts',
		cycle_off: 'Cycle break starts',
		cycle_on: 'Cycle resumes',
		ends: 'Protocol ends'
	} as const;
</script>

<svelte:head><title>{data.compound.name} · Peptides · Fitness Tracker</title></svelte:head>

<PageHeader title={data.compound.name} back="/peptides">
	{#snippet actions()}
		<button
			type="button"
			aria-label="Edit compound"
			onclick={() => (compoundOpen = true)}
			class="h-9 w-9 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
		>
			<Icon name="edit" size={18} />
		</button>
	{/snippet}
</PageHeader>

<div class="mx-auto max-w-md px-4 pb-8 space-y-5">
	<!-- Identity -->
	<Card>
		<p class="text-xs text-[var(--color-text-muted)]">
			{categoryLabel(data.compound.category)}{#if data.compound.isBlend}{' · '}Blend{/if}{#if data.compound.halfLifeHours}{' · '}~{formatHalfLife(data.compound.halfLifeHours)} half-life{/if}{#if !data.compound.active}{' · '}inactive{/if}
		</p>
		{#if data.compound.isBlend && data.compound.components}
			<p class="mt-2 text-sm text-[var(--color-text)]">{blendRatioSummary(data.compound.components)}{#if data.compound.vialMg}<span class="text-[var(--color-text-muted)]">{' '}({data.compound.vialMg} mg vial)</span>{/if}</p>
			<div class="mt-2 flex flex-wrap gap-1.5">
				{#each data.compound.components as c (c.name)}
					{#if c.peptideId}
						<a href={`/peptides/${c.peptideId}`} class="h-8 px-3 flex items-center rounded-full border border-[var(--color-border)] text-xs font-medium text-[var(--color-text)] hover:bg-[var(--color-surface-alt)]">
							{c.name} <Icon name="chevron-right" size={14} />
						</a>
					{/if}
				{/each}
			</div>
		{/if}
		{#if data.partOf.length > 0}
			<p class="mt-2 text-xs text-[var(--color-text-muted)]">
				Also taken as part of
				{#each data.partOf as b, i (b.id)}{#if i > 0}{', '}{/if}<a href={`/peptides/${b.id}`} class="text-[var(--color-accent)] font-medium">{b.name}</a>{/each} — those doses count here too.
			</p>
		{/if}
		{#if data.compound.notes}<p class="mt-2 text-sm text-[var(--color-text-muted)] whitespace-pre-line">{data.compound.notes}</p>{/if}
	</Card>

	<DueTodayCard rows={data.due} onAdjust={(row) => openLog(row.protocolId)} />

	<Button variant="primary" size="lg" full class="w-full" onclick={() => openLog()}>
		<Icon name="plus" size={20} /> Log {data.compound.name}
	</Button>

	<!-- Intake -->
	{#if data.totalsAll.length > 0}
		<div>
			<h2 class="section-label mb-2 px-1">What you've taken</h2>
			<Card padded={false} class="divide-y divide-[var(--color-border)]">
				{#each data.totalsAll as t (`${t.route}`)}
					{@const t30 = data.totals30.find((x) => x.route === t.route)}
					<div class="px-4 py-3">
						<p class="text-sm text-[var(--color-text)]">
							{t.route ? ROUTE_LABELS[t.route] : 'Route not recorded'}
						</p>
						<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
							Last 30 days: {t30 ? `${formatDose(t30.totalMcg)} over ${t30.doseCount} dose${t30.doseCount === 1 ? '' : 's'}` : 'none'}{#if t30 && t30.viaBlendMcg > 0}{' '}({formatDose(t30.viaBlendMcg)} via blends){/if}
						</p>
						<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
							All time: {formatDose(t.totalMcg)} since {fmtDate(t.firstDate)}{#if t.estimated}{' · '}some blend splits estimated{/if}
						</p>
					</div>
				{/each}
			</Card>
		</div>
	{/if}

	<!-- Protocols -->
	<div>
		<div class="flex items-center justify-between mb-2 px-1">
			<h2 class="section-label">Protocols</h2>
			<button type="button" onclick={() => ((editingProtocol = null), (protocolOpen = true))} class="text-sm text-[var(--color-accent)] font-medium">+ Add</button>
		</div>
		{#if data.protocols.length === 0}
			<p class="px-1 text-sm text-[var(--color-text-muted)]">No protocol yet — add one to get “due today” reminders and adherence.</p>
		{:else}
			<Card padded={false} class="divide-y divide-[var(--color-border)]">
				{#each data.protocols as p (p.id)}
					<div class="px-4 py-3">
						<div class="flex items-start gap-3">
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] {p.active ? '' : 'opacity-50'}">
									{formatDose(p.targetMcg)} · {p.schedule}{#if p.timeOfDay}{' · '}{p.timeOfDay}{/if}
									{#if p.phase !== 'regular' && p.active}<span class="ml-1 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)]">{p.phase === 'loading' ? 'Loading' : 'Tapering'}</span>{/if}
								</p>
								<p class="text-xs text-[var(--color-text-muted)]">
									{#if !p.active}Paused{:else if p.nextDue}Next due {relDays(p.nextDue)}{:else if p.frequency === 'x_per_week'}Flexible weekly target{:else}Nothing scheduled soon{/if}{#if p.adherence.pct != null}{' · '}{p.adherence.pct}% last 30 days{/if}{#if p.route}{' · '}{ROUTE_LABELS[p.route]}{/if}
								</p>
								{#each p.upcoming as u (u.kind + u.date)}
									<p class="text-xs text-[var(--color-accent)]">{CHANGE_LABEL[u.kind]} {relDays(u.date)} ({fmtDate(u.date)}){#if u.doseMcg != null}{' → '}{formatDose(u.doseMcg)}{/if}</p>
								{/each}
								{#if p.mix && p.components?.length}
									<p class="text-xs text-[var(--color-text-muted)] mt-0.5">Custom mix: {blendRatioSummary(p.mix)}</p>
								{/if}
							</div>
							<button
								type="button"
								aria-label="Edit protocol"
								onclick={() => ((editingProtocol = p), (protocolOpen = true))}
								class="h-8 w-8 shrink-0 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
							>
								<Icon name="edit" size={15} />
							</button>
						</div>
					</div>
				{/each}
			</Card>
		{/if}
	</div>

	{#if data.adherence.totals.scheduled > 0}
		<Card>
			<div class="flex items-center justify-between mb-3">
				<h2 class="section-label">Adherence · {data.adherence.windowDays} days</h2>
				<span class="text-sm font-semibold text-[var(--color-text)] tabular-nums">{data.adherence.pct != null ? `${data.adherence.pct}%` : '—'}</span>
			</div>
			<AdherenceCalendar days={data.adherence.calendar} today={data.today} />
		</Card>
	{/if}

	<!-- Level -->
	{#if level && data.compound.halfLifeHours}
		<div>
			<div class="flex items-center justify-between mb-2 px-1">
				<h2 class="section-label">Estimated level · 30 days</h2>
				<a href="/peptides/levels" class="text-sm font-medium text-[var(--color-accent)]">More</a>
			</div>
			<Card>
				{#if data.levels.length > 1}
					<div class="flex gap-1.5 mb-3">
						{#each data.levels as l (l.route ?? '')}
							<Chip selected={l === level} onclick={() => (levelRoute = l.route ?? '')}>{l.route ? ROUTE_LABELS[l.route] : 'Other'}</Chip>
						{/each}
					</div>
				{/if}
				<div class="grid grid-cols-2 gap-2 mb-3">
					<StatCard label="Active now (est.)" value={formatLevel(activeNow)} />
					<StatCard label="Half-life" value={formatHalfLife(data.compound.halfLifeHours)} />
				</div>
				<LevelChart points={levelPoints} fromMs={levelFrom} toMs={data.nowMs} />
				<p class="mt-2 text-xs text-[var(--color-text-muted)]">A rough single-compartment estimate (blend doses included) — not a PK model or dosing guidance.</p>
			</Card>
		</div>
	{/if}

	<!-- Supply -->
	<div>
		<div class="flex items-center justify-between mb-2 px-1">
			<h2 class="section-label">Supply</h2>
			<button type="button" onclick={() => ((editingVial = null), (vialOpen = true))} class="text-sm text-[var(--color-accent)] font-medium">+ Add</button>
		</div>
		{#if data.vials.length === 0}
			<p class="px-1 text-sm text-[var(--color-text-muted)]">No containers yet — add one to track what's left and when it runs out.</p>
		{:else}
			<Card padded={false} class="divide-y divide-[var(--color-border)]">
				{#each data.vials as v (v.id)}
					<button type="button" onclick={() => ((editingVial = v), (vialOpen = true))} class="w-full text-left px-4 py-3 {v.depleted ? 'opacity-50' : ''}">
						<p class="text-sm text-[var(--color-text)]">
							{v.form === 'vial' ? `${v.vialMg} mg vial${v.bacWaterMl ? ` · ${v.bacWaterMl} mL` : ''}` : CONTAINER_FORM_LABELS[v.form]}{#if v.depleted}{' · '}used up{/if}
						</p>
						<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
							{#if v.status.remainingMcg != null}{formatDose(v.status.remainingMcg)} left{/if}{#if v.status.dosesLeft != null}{' · '}~{v.status.dosesLeft} {v.status.unit === 'dose' ? (v.status.dosesLeft === 1 ? 'dose' : 'doses') : MEASURE_UNIT_LABELS[v.status.unit]}{/if}{#if v.status.projection?.runsOutOn}{' · '}runs out ~{fmtDate(v.status.projection.runsOutOn)}{:else if v.status.projection?.beyondHorizon}{' · '}lasts 1+ year{/if}
						</p>
						{#if v.expiresAt}
							<p class="text-xs {v.status.expiry ? 'text-[var(--color-danger)]' : 'text-[var(--color-text-muted)]'}">
								{v.status.expiry === 'expired' ? 'Expired' : 'Expires'} {fmtDate(v.expiresAt)}
							</p>
						{/if}
					</button>
				{/each}
			</Card>
		{/if}
	</div>

	<!-- Side effects -->
	{#if data.effects.doses > 0}
		<div>
			<h2 class="section-label mb-2 px-1">Side effects · {data.effects.windowDays} days</h2>
			<Card>
				{#if data.effects.tags.length === 0}
					<p class="text-sm text-[var(--color-text-muted)]">
						Nothing reported{#if data.effects.checkedIn === 0}{' '}— tap the check-in icon on a dose below to record how it went{/if}.
					</p>
				{:else}
					<div class="flex flex-wrap gap-1.5">
						{#each data.effects.tags as t (t.tag)}
							<span class="rounded-full bg-[var(--color-surface-alt)] px-2.5 py-1 text-xs text-[var(--color-text)]">
								{effectLabel(t.tag)} · {t.count}× <span class="text-[var(--color-text-muted)]">(up to {SEVERITY_LABELS[t.max].toLowerCase()})</span>
							</span>
						{/each}
					</div>
					<p class="mt-2 text-xs text-[var(--color-text-muted)]">Across {data.effects.doses} doses, {data.effects.checkedIn} with a check-in.</p>
				{/if}
			</Card>
		</div>
	{/if}

	<!-- History -->
	{#if data.history.length > 0}
		<div>
			<h2 class="section-label mb-2 px-1">History</h2>
			<DoseHistoryList
				rows={data.history}
				showCompound={false}
				onEdit={(row) => ((editingDose = row), (logInitial = null), (logOpen = true))}
				viaBlend={(row) => (row.peptideId !== data.compound.id && data.viaShare[row.id] != null ? { mcg: data.viaShare[row.id] } : null)}
			/>
		</div>
	{/if}

	<!-- Photos -->
	{#if data.photoCount > 0}
		<div>
			<div class="flex items-center justify-between mb-2 px-1">
				<h2 class="section-label">Photos</h2>
				<a href="/peptides/photos" class="text-sm font-medium text-[var(--color-accent)]">All {data.photoCount}</a>
			</div>
			<div class="grid grid-cols-3 gap-2">
				{#each data.photos as photo (photo.id)}
					<a href="/peptides/photos" class="block overflow-hidden rounded-[var(--radius-md)] bg-[var(--color-surface-alt)]">
						<img src={`/peptides/photos/${photo.id}/file`} alt={`Photo ${fmtDate(photo.date)}`} class="aspect-[3/4] w-full object-cover" loading="lazy" />
					</a>
				{/each}
			</div>
		</div>
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
<CompoundModal bind:open={compoundOpen} compound={data.compound} />
<ProtocolModal bind:open={protocolOpen} compounds={data.compounds} protocol={editingProtocol} defaultPeptideId={data.compound.id} />
<VialModal bind:open={vialOpen} compounds={data.compounds} vial={editingVial} defaultPeptideId={data.compound.id} />
