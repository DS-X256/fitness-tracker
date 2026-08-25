<script lang="ts">
	import { enhance } from '$app/forms';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import HealthNav from '$lib/components/HealthNav.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import StatCard from '$lib/components/StatCard.svelte';
	import AdherenceCalendar from '$lib/components/peptides/AdherenceCalendar.svelte';
	import LogDoseModal from '$lib/components/peptides/LogDoseModal.svelte';
	import { formatDose, siteLabel, MEASURE_UNIT_LABELS } from '$lib/utils/peptides';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	let logOpen = $state(false);
	let logInitial = $state<{ peptideId?: number; doseMcg?: number | null; protocolId?: number | null } | null>(null);
	let editingDose = $state<NonNullable<PageData['recent']>[number] | null>(null);

	function openLog(initial: typeof logInitial = null) {
		logInitial = initial;
		editingDose = null;
		logOpen = true;
	}

	function openEdit(dose: NonNullable<PageData['recent']>[number]) {
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
				A personal log for a regimen you already follow — not medical advice, and no dosing is suggested for you.
				Doses and schedules are the ones you enter. Discuss any protocol with a qualified clinician.
			</p>
		</div>

		<!-- Due today -->
		{#if data.due.length > 0}
			<div>
				<h2 class="section-label mb-2 px-1">Due today · {fmtDate(data.today)}</h2>
				<Card padded={false} class="divide-y divide-[var(--color-border)]">
					{#each data.due as d (d.protocolId)}
						<div class="flex items-center gap-3 px-4 py-3">
							<div class="flex-1 min-w-0">
								<p class="text-sm font-medium text-[var(--color-text)] truncate">
									{d.peptideName}
									{#if d.loading}<span class="ml-1.5 text-[10px] font-semibold uppercase tracking-wide text-[var(--color-accent)] align-middle">Loading</span>{/if}
								</p>
								<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
									{formatDose(d.doseMcg)}{#if d.timeOfDay} · {d.timeOfDay}{/if}
								</p>
							</div>
							{#if d.logged}
								<span class="flex items-center gap-1 text-xs font-medium text-[var(--color-success)]">
									<Icon name="check" size={16} /> Logged
								</span>
							{:else}
								<form method="POST" action="?/quickLog" use:enhance>
									<input type="hidden" name="protocolId" value={d.protocolId} />
									<button
										type="submit"
										class="h-9 px-3 rounded-[var(--radius-md)] bg-[var(--color-accent)] text-[var(--color-on-accent)] text-sm font-medium active:scale-[0.98]"
									>
										Log
									</button>
								</form>
							{/if}
						</div>
					{/each}
				</Card>
			</div>
		{/if}

		<Button variant="primary" size="lg" full class="w-full" onclick={() => openLog()}>
			<Icon name="plus" size={20} /> Log a dose
		</Button>

		<!-- Adherence + calendar -->
		{#if data.adherence}
			<Card>
				<div class="flex items-center justify-between mb-3">
					<h2 class="section-label">Adherence · 30 days</h2>
					<span class="text-sm font-semibold text-[var(--color-text)] tabular-nums">{data.adherence.pct}%</span>
				</div>
				<AdherenceCalendar days={data.calendar} today={data.today} />
				<p class="mt-3 text-xs text-[var(--color-text-muted)] tabular-nums">
					{data.adherence.taken} of {data.adherence.total} scheduled doses logged
				</p>
			</Card>
		{/if}

		<!-- Vial alerts -->
		{#if data.vialAlerts.some((v) => v.expiry || v.low)}
			<div>
				<h2 class="section-label mb-2 px-1">Vials needing attention</h2>
				<Card padded={false} class="divide-y divide-[var(--color-border)]">
					{#each data.vialAlerts.filter((v) => v.expiry || v.low) as v (v.id)}
						<div class="flex items-center gap-3 px-4 py-3">
							<div class="mt-0.5 shrink-0 text-[var(--color-danger)]"><Icon name="alert" size={18} /></div>
							<div class="flex-1 min-w-0 text-sm">
								<p class="text-[var(--color-text)] truncate">{v.peptideName}{#if v.vialMg} · {v.vialMg} mg{/if}</p>
								<p class="text-xs text-[var(--color-text-muted)]">
									{#if v.expiry === 'expired'}Expired {v.expiresAt}{:else if v.expiry === 'soon'}Expires {v.expiresAt}{/if}
									{#if (v.expiry) && v.low} · {/if}
									{#if v.low}~{v.dosesLeft} {MEASURE_UNIT_LABELS[v.unit]} left{#if v.daysLeft != null} · ~{v.daysLeft}d supply{/if}{/if}
								</p>
							</div>
						</div>
					{/each}
				</Card>
			</div>
		{/if}

		<!-- Recent history -->
		{#if data.recent.length > 0}
			<div>
				<h2 class="section-label mb-2 px-1">Recent doses</h2>
				<Card padded={false} class="divide-y divide-[var(--color-border)]">
					{#each data.recent as dose (dose.id)}
						<div class="flex items-center gap-2 px-4 py-2.5">
							<div class="flex-1 min-w-0">
								<p class="text-sm text-[var(--color-text)] truncate">
									{dose.peptideName}
									<span class="text-[var(--color-text-muted)] tabular-nums"> · {formatDose(dose.doseMcg)}</span>
								</p>
								<p class="text-xs text-[var(--color-text-muted)] tabular-nums">
									{fmtDate(dose.date)}{#if dose.site} · {siteLabel(dose.site)}{/if}{#if dose.kind !== 'dose'} · {dose.kind === 'prime' ? 'Prime' : 'Removed'}{/if}
								</p>
							</div>
							<button
								type="button"
								aria-label="Edit dose"
								onclick={() => openEdit(dose)}
								class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
							>
								<Icon name="edit" size={15} />
							</button>
							<form method="POST" action="?/deleteDose" use:enhance>
								<input type="hidden" name="id" value={dose.id} />
								<button
									type="submit"
									aria-label="Delete dose"
									class="h-8 w-8 flex items-center justify-center rounded-full text-[var(--color-text-muted)] hover:bg-[var(--color-danger-soft)] hover:text-[var(--color-danger)]"
								>
									<Icon name="x" size={16} />
								</button>
							</form>
						</div>
					{/each}
				</Card>
			</div>
		{/if}

		<!-- Empty state -->
		{#if data.peptides.length === 0}
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
		peptides={data.peptides}
		vials={data.activeVials}
		recentSites={data.siteHistory}
		initial={logInitial}
		editing={editingDose}
	/>
{/if}
