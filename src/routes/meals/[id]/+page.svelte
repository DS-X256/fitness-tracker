<script lang="ts">
	import { enhance } from '$app/forms';
	import { celebrate } from '$lib/utils/kitten';
	import PageHeader from '$lib/components/PageHeader.svelte';
	import Card from '$lib/components/Card.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import EmptyState from '$lib/components/EmptyState.svelte';
	import IngredientRow from '$lib/components/meals/IngredientRow.svelte';
	import IngredientPicker from '$lib/components/meals/IngredientPicker.svelte';
	import ShareMealsModal from '$lib/components/meals/ShareMealsModal.svelte';
	import MealPhotoModal from '$lib/components/meals/MealPhotoModal.svelte';
	import NumberStepper from '$lib/components/NumberStepper.svelte';
	import PortionPicker from '$lib/components/PortionPicker.svelte';
	import { formatPortionsPhrase } from '$lib/utils/formatPortions';
	import type { PageData } from './$types';

	let { data }: { data: PageData } = $props();
	const meal = $derived(data.meal);
	const isOwner = $derived(data.meal.isOwner);

	let pickerOpen = $state(false);
	let shareOpen = $state(false);
	let photoOpen = $state(false);
	const photoSrc = $derived(`/meals/${meal.id}/photo?v=${meal.updatedAt.getTime()}`);
	let added = $state(false);
	let addedCount = $state(0);
	let addedTimeout: ReturnType<typeof setTimeout> | undefined;
	let addMultiplier = $state(1);

	let logPortions = $state(1);
	let logged = $state(false);
	let logError = $state('');
	let loggedTimeout: ReturnType<typeof setTimeout> | undefined;

	function fmt(n: number) {
		return Number.isInteger(n) ? n : Math.round(n * 10) / 10;
	}

	const macroRows = $derived([
		{ label: 'Calories', value: meal.totalMacros.calories, unit: 'kcal' },
		{ label: 'Protein', value: meal.totalMacros.protein, unit: 'g' },
		{ label: 'Carbs', value: meal.totalMacros.carbs, unit: 'g' },
		{ label: 'Fat', value: meal.totalMacros.fat, unit: 'g' }
	]);
</script>

<svelte:head><title>{meal.name} · Fitness Tracker</title></svelte:head>

{#snippet headerActions()}
	<Button variant="ghost" size="md" onclick={() => (shareOpen = true)}>Share</Button>
	<Button href={`/meals/${meal.id}/edit`} variant="ghost" size="icon">
		<Icon name="edit" size={20} />
		<span class="sr-only">Edit meal</span>
	</Button>
{/snippet}

<PageHeader
	title={meal.name}
	back={isOwner ? '/meals' : `/meals?owner=${meal.userId}`}
	actions={isOwner ? headerActions : undefined}
/>

<div class="mx-auto max-w-md space-y-4 px-4 pb-6">
	{#if meal.photoFilename}
		{#if isOwner}
			<button
				type="button"
				class="block w-full overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]"
				onclick={() => (photoOpen = true)}
			>
				<img src={photoSrc} alt="" class="aspect-video w-full object-cover" />
			</button>
		{:else}
			<div class="overflow-hidden rounded-[var(--radius-lg)] border border-[var(--color-border)]">
				<img src={photoSrc} alt="" class="aspect-video w-full object-cover" />
			</div>
		{/if}
	{:else if isOwner}
		<button
			type="button"
			class="flex w-full items-center justify-center gap-1.5 rounded-[var(--radius-md)] border border-dashed border-[var(--color-border)] py-2.5 text-sm text-[var(--color-text-muted)] hover:bg-[var(--color-surface-alt)]"
			onclick={() => (photoOpen = true)}
		>
			<Icon name="camera" size={16} />
			Add photo
		</button>
	{/if}

	<Card>
		<div class="grid grid-cols-2 gap-3">
			{#each macroRows as row (row.label)}
				<div class="rounded-[var(--radius-md)] bg-[var(--color-surface-alt)] px-3 py-2.5">
					<p class="text-xs text-[var(--color-text-muted)]">{row.label}</p>
					<p class="text-lg font-semibold text-[var(--color-text)] tabular-nums">
						{fmt(row.value)}<span class="ml-1 text-xs font-normal text-[var(--color-text-muted)]">{row.unit}</span>
					</p>
				</div>
			{/each}
		</div>

		<p class="mt-3 border-t border-[var(--color-border)] pt-3 text-xs text-[var(--color-text-muted)]">
			Makes {fmt(meal.portions)} {meal.portions === 1 ? 'portion' : 'portions'}
			{#if meal.portions !== 1}
				· per portion: <span class="font-medium text-[var(--color-text)]">{fmt(meal.perPortionMacros.calories)} kcal</span>
				· {fmt(meal.perPortionMacros.protein)}p {fmt(meal.perPortionMacros.carbs)}c {fmt(meal.perPortionMacros.fat)}f
			{/if}
		</p>

		{#if meal.categories.length}
			<div class="mt-3 flex flex-wrap gap-1.5 border-t border-[var(--color-border)] pt-3">
				{#each meal.categories as c (c.id)}
					<span
						class="inline-flex h-7 items-center rounded-full bg-[var(--color-surface-alt)] px-2.5 text-xs font-medium text-[var(--color-text-muted)]"
						>{c.name}</span
					>
				{/each}
			</div>
		{/if}
	</Card>

	{#if meal.notes}
		<Card>
			<h2 class="section-label mb-2">Notes</h2>
			<p class="whitespace-pre-wrap text-sm text-[var(--color-text)]">{meal.notes}</p>
		</Card>
	{/if}

	<Card>
		<h2 class="section-label mb-2">Log to today</h2>
		<form
			method="POST"
			action="?/logToDay"
			use:enhance={() => {
				logError = '';
				return async ({ result, update }) => {
					if (result.type === 'success') {
						logged = true;
						celebrate();
						clearTimeout(loggedTimeout);
						loggedTimeout = setTimeout(() => (logged = false), 2000);
					} else if (result.type === 'failure') {
						logError = (result.data?.error as string) ?? 'Could not log meal';
					}
					await update({ reset: false });
				};
			}}
		>
			<PortionPicker name="portions" label="Portions eaten" bind:value={logPortions} />
			<div class="mt-3 flex items-center justify-between gap-2">
				<p class="text-xs text-[var(--color-text-muted)]">
					{#if logPortions > 0}
						≈ {Math.round(meal.perPortionMacros.calories * logPortions)} kcal for {formatPortionsPhrase(
							logPortions,
							'portion'
						)}
					{:else}
						Pick an amount to see calories.
					{/if}
				</p>
				<Button type="submit" variant="primary" class="h-12" disabled={logPortions <= 0}>
					<Icon name="check" size={18} />
					Log
				</Button>
			</div>
		</form>
		{#if logged}
			<p class="mt-1 text-sm text-[var(--color-success)]">Logged to today</p>
		{/if}
		{#if logError}
			<p class="mt-1 text-sm text-[var(--color-danger)]">{logError}</p>
		{/if}
	</Card>

	<Card>
		<h2 class="section-label mb-2">Shopping list</h2>
		<form
			method="POST"
			action="?/addToList"
			class="space-y-2"
			use:enhance={() => {
				return async ({ result, update }) => {
					if (result.type === 'success') {
						addedCount = (result.data?.count as number) ?? 0;
						added = true;
						clearTimeout(addedTimeout);
						addedTimeout = setTimeout(() => (added = false), 2000);
					}
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="multiplier" value={addMultiplier} />
			<NumberStepper label="Batches (2 = double the recipe)" bind:value={addMultiplier} step={0.5} min={0.5} />
			<Button type="submit" variant="secondary" size="lg" full class="w-full">
				<Icon name="cart" size={18} />
				Add ingredients
			</Button>
		</form>
		{#if added}
			<p class="mt-2 text-center text-sm text-[var(--color-success)]">
				{#if addedCount > 0}
					Added {addedCount} {addedCount === 1 ? 'item' : 'items'} to your shopping list
				{:else}
					This meal has no ingredients yet
				{/if}
			</p>
		{/if}
	</Card>

	<div>
		<h2 class="section-label mb-2 px-1">Ingredients</h2>
		{#if meal.ingredients.length === 0}
			<EmptyState
				icon="meals"
				title="No ingredients yet"
				description={isOwner
					? 'Add a product or another meal below to build this recipe.'
					: 'This meal has no ingredients yet.'}
			/>
		{:else}
			<Card>
				<div class="divide-y divide-[var(--color-border)]">
					{#each meal.ingredients as ingredient (ingredient.id)}
						<IngredientRow {ingredient} readonly={!isOwner} />
					{/each}
				</div>
			</Card>
		{/if}
		{#if isOwner}
			<Button variant="secondary" full size="lg" class="mt-3 w-full" onclick={() => (pickerOpen = true)}>
				<Icon name="plus" size={18} />
				Add ingredient
			</Button>
		{/if}
	</div>

	{#if isOwner}
		<form
			method="POST"
			action="?/delete"
			use:enhance={({ cancel }) => {
				if (!confirm(`Delete "${meal.name}"? This can't be undone.`)) {
					cancel();
				}
			}}
		>
			<Button type="submit" variant="danger" size="md" full class="w-full">
				<Icon name="trash" size={16} />
				Delete meal
			</Button>
		</form>
	{/if}
</div>

{#if isOwner}
	<IngredientPicker bind:open={pickerOpen} products={data.products} subMeals={data.subMeals} />
	<ShareMealsModal bind:open={shareOpen} shares={data.shares} meal={{ id: meal.id, name: meal.name }} />
	<MealPhotoModal bind:open={photoOpen} hasPhoto={!!meal.photoFilename} {photoSrc} />
{/if}
