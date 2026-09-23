<script lang="ts">
	// A GitHub-style contribution grid for dose adherence. `days` is ascending (oldest first); each cell is
	// coloured by that day's status from the shared adherence engine (peptideAdherence.calendarDays):
	// taken / partial / skipped / missed / due-today / unscheduled dose / rest. Hand-rolled to match the
	// app's no-charting-library convention (see ProgressChart).
	import type { DayStatus } from '$lib/utils/peptideAdherence';

	type Day = { date: string; count: number; status: DayStatus };
	let { days, today }: { days: Day[]; today: string } = $props();

	function weekday(iso: string): number {
		const [y, m, d] = iso.split('-').map(Number);
		return new Date(y, m - 1, d, 12).getDay();
	}

	// Pad the front so the first column starts on the correct weekday row (Sun = row 0), then chunk to weeks.
	const columns = $derived.by(() => {
		if (days.length === 0) return [] as (Day | null)[][];
		const pad = weekday(days[0].date);
		const cells: (Day | null)[] = [...Array(pad).fill(null), ...days];
		const cols: (Day | null)[][] = [];
		for (let i = 0; i < cells.length; i += 7) cols.push(cells.slice(i, i + 7));
		return cols;
	});

	const FILL: Record<DayStatus, string> = {
		taken: 'bg-[var(--color-accent)]',
		extra: 'bg-[var(--color-accent)] opacity-60',
		partial: 'bg-[var(--color-accent)] opacity-40',
		skipped: 'bg-[var(--color-text-muted)] opacity-40',
		missed: 'bg-[var(--color-danger-soft)]',
		pending: 'bg-[var(--color-accent-soft)]',
		rest: 'bg-[var(--color-surface-alt)]'
	};

	function cellClass(day: Day | null): string {
		if (!day) return 'bg-transparent';
		const ring = day.date === today ? ' ring-2 ring-[var(--color-accent)] ring-offset-1 ring-offset-[var(--color-surface)]' : '';
		return `${FILL[day.status]}${ring}`;
	}

	function label(day: Day | null): string {
		if (!day) return '';
		const when = new Date(`${day.date}T00:00:00`).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
		const doses = day.count > 0 ? ` (${day.count} dose${day.count > 1 ? 's' : ''})` : '';
		switch (day.status) {
			case 'taken':
				return `${when}: all scheduled doses taken${doses}`;
			case 'partial':
				return `${when}: some scheduled doses missing${doses}`;
			case 'skipped':
				return `${when}: skipped${doses}`;
			case 'missed':
				return `${when}: scheduled dose missed`;
			case 'pending':
				return `${when}: dose due`;
			case 'extra':
				return `${when}: dose logged on an unscheduled day${doses}`;
			default:
				return `${when}: nothing scheduled`;
		}
	}
</script>

<div class="overflow-x-auto">
	<div class="flex gap-1 min-w-max">
		{#each columns as col, ci (ci)}
			<div class="flex flex-col gap-1">
				{#each col as day, ri (ri)}
					<div class={`h-3.5 w-3.5 rounded-[3px] ${cellClass(day)}`} title={label(day)}></div>
				{/each}
			</div>
		{/each}
	</div>
</div>

<div class="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-xs text-[var(--color-text-muted)]">
	<span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-[3px] {FILL.taken}"></span> Taken</span>
	<span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-[3px] {FILL.partial}"></span> Partial</span>
	<span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-[3px] {FILL.skipped}"></span> Skipped</span>
	<span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-[3px] {FILL.missed}"></span> Missed</span>
	<span class="flex items-center gap-1.5"><span class="h-3 w-3 rounded-[3px] {FILL.pending}"></span> Due</span>
</div>
