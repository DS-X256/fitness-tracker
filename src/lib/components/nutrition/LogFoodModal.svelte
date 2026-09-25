<script lang="ts">
	import { enhance } from '$app/forms';
	import { celebrate } from '$lib/utils/kitten';
	import { goto } from '$app/navigation';
	import Modal from '$lib/components/Modal.svelte';
	import TextField from '$lib/components/TextField.svelte';
	import NumberField from '$lib/components/NumberField.svelte';
	import PortionPicker from '$lib/components/PortionPicker.svelte';
	import Button from '$lib/components/Button.svelte';
	import Icon from '$lib/components/Icon.svelte';
	import BarcodeScanner from '$lib/components/BarcodeScanner.svelte';
	import { formatPortionsPhrase } from '$lib/utils/formatPortions';

	type MealOption = { id: number; name: string; portions: number; totalMacros: { calories: number } };
	type ProductOption = { id: number; name: string; brand: string | null; calories: number; amount: number; unit: string };
	type Selected = { kind: 'meal' | 'product'; id: number; name: string; kcalPerPortion: number; unitLabel: string };

	let {
		open = $bindable(false),
		meals,
		products
	}: {
		open?: boolean;
		meals: MealOption[];
		products: ProductOption[];
	} = $props();

	type CatalogMatch = { id: number; name: string; brand: string | null; amount: number; unit: string; calories: number; protein: number; carbs: number; fat: number };

	let query = $state('');
	let selected = $state<Selected | null>(null);
	let portions = $state(1);
	let error = $state('');
	let scanOpen = $state(false);
	let scanBusy = $state(false);
	let catalogResults = $state<CatalogMatch[]>([]);
	let addingCatalog = $state(false);

	// Quick add — log typed-in macros with no product behind them.
	let quickAdd = $state(false);
	let qaName = $state('');
	let qaCalories = $state<number | null>(null);
	let qaProtein = $state<number | null>(null);
	let qaCarbs = $state<number | null>(null);
	let qaFat = $state<number | null>(null);

	const term = $derived(query.trim().toLowerCase());
	const mealResults = $derived(meals.filter((m) => !term || m.name.toLowerCase().includes(term)));
	const productResults = $derived(
		products.filter((p) => !term || p.name.toLowerCase().includes(term) || p.brand?.toLowerCase().includes(term))
	);

	// Debounced catalog search. Hide catalog items the user already owns (same name+brand).
	let catalogHandle: ReturnType<typeof setTimeout> | undefined;
	$effect(() => {
		const q = query.trim();
		clearTimeout(catalogHandle);
		if (q.length < 2 || selected) {
			catalogResults = [];
			return;
		}
		catalogHandle = setTimeout(async () => {
			try {
				const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}`);
				if (!res.ok) return;
				const data = (await res.json()) as { matches: CatalogMatch[] };
				const owned = new Set(products.map((p) => `${p.name.toLowerCase()}|${(p.brand ?? '').toLowerCase()}`));
				catalogResults = data.matches.filter((m) => !owned.has(`${m.name.toLowerCase()}|${(m.brand ?? '').toLowerCase()}`));
			} catch {
				catalogResults = [];
			}
		}, 300);
		return () => clearTimeout(catalogHandle);
	});

	/** Add a catalog product to the user's own products, then select it for logging. */
	async function pickCatalog(c: CatalogMatch) {
		if (addingCatalog) return;
		addingCatalog = true;
		error = '';
		try {
			const res = await fetch('/api/catalog/add', {
				method: 'POST',
				headers: { 'Content-Type': 'application/json' },
				body: JSON.stringify({ catalogId: c.id })
			});
			if (!res.ok) throw new Error();
			const { product } = await res.json();
			pickProduct(product);
			catalogResults = [];
		} catch {
			error = 'Could not add that product — try again.';
		} finally {
			addingCatalog = false;
		}
	}

	function mealKcalPerPortion(meal: MealOption) {
		const recipePortions = meal.portions > 0 ? meal.portions : 1;
		return meal.totalMacros.calories / recipePortions;
	}

	function pickMeal(meal: MealOption) {
		selected = {
			kind: 'meal',
			id: meal.id,
			name: meal.name,
			kcalPerPortion: mealKcalPerPortion(meal),
			unitLabel: 'Portions'
		};
		portions = 1;
		error = '';
	}

	function pickProduct(product: ProductOption) {
		selected = {
			kind: 'product',
			id: product.id,
			name: product.brand ? `${product.name} (${product.brand})` : product.name,
			kcalPerPortion: product.calories,
			unitLabel: 'Servings'
		};
		portions = 1;
		error = '';
	}

	function reset() {
		open = false;
		query = '';
		selected = null;
		portions = 1;
		error = '';
		catalogResults = [];
		quickAdd = false;
		qaName = '';
		qaCalories = null;
		qaProtein = null;
		qaCarbs = null;
		qaFat = null;
	}

	/** Scan from the log flow: a locally saved product is selected for logging on the spot; anything
	 *  else hands off to the product-creation page with the lookup's prefill in the querystring. */
	async function handleScan(code: string) {
		scanBusy = true;
		error = '';
		try {
			const res = await fetch(`/api/barcode/${code}`);
			if (!res.ok) throw new Error();
			const data = await res.json();
			if (data.source === 'local') {
				pickProduct(data.product);
			} else if (data.source === 'off' || data.source === 'off-cache') {
				const p = data.prefill;
				const params = new URLSearchParams({
					barcode: data.barcode,
					name: p.name,
					amount: String(p.amount),
					unit: p.unit,
					calories: String(p.calories),
					protein: String(p.protein),
					carbs: String(p.carbs),
					fat: String(p.fat)
				});
				if (p.brand) params.set('brand', p.brand);
				reset();
				await goto(`/shopping-list/products/new?${params}`);
			} else if (data.source === 'none') {
				reset();
				await goto(`/shopping-list/products/new?barcode=${data.barcode}`);
			} else {
				error = 'Lookup service unreachable — try again in a moment.';
			}
		} catch {
			error = 'Barcode lookup failed — try again.';
		} finally {
			scanBusy = false;
		}
	}
</script>

<Modal bind:open title="Log food" onclose={reset}>
	{#if selected}
		<p class="mb-1 text-sm text-[var(--color-text)]">
			Logging <span class="font-medium">{selected.name}</span>
		</p>
		<p class="mb-3 text-xs text-[var(--color-text-muted)]">
			{#if portions > 0}
				≈ {Math.round(selected.kcalPerPortion * portions)} kcal for {formatPortionsPhrase(
					portions,
					selected.kind === 'meal' ? 'portion' : 'serving'
				)}
			{:else}
				Pick an amount to see calories.
			{/if}
		</p>
		<form
			method="POST"
			action="?/logFood"
			use:enhance={() => {
				error = '';
				return async ({ result, update }) => {
					if (result.type === 'success') {
						reset();
						celebrate();
						celebrate();
					} else if (result.type === 'failure') {
						error = (result.data?.error as string) ?? 'Could not log';
					}
					await update({ reset: false });
				};
			}}
		>
			<input type="hidden" name="kind" value={selected.kind} />
			<input type="hidden" name="refId" value={selected.id} />
			<PortionPicker name="portions" label={selected.unitLabel} bind:value={portions} class="mb-3" />
			<div class="flex gap-2">
				<Button type="button" variant="ghost" onclick={() => (selected = null)}>Back</Button>
				<Button type="submit" variant="primary" full class="flex-1" disabled={portions <= 0}>Log</Button>
			</div>
		</form>
	{:else if quickAdd}
		<p class="mb-3 text-sm text-[var(--color-text-muted)]">
			For meals you can't measure — log your best estimate and move on.
		</p>
		<form
			method="POST"
			action="?/quickAdd"
			use:enhance={() => {
				error = '';
				return async ({ result, update }) => {
					if (result.type === 'success') {
						reset();
					} else if (result.type === 'failure') {
						error = (result.data?.error as string) ?? 'Could not log';
					}
					await update({ reset: false });
				};
			}}
		>
			<div class="space-y-3">
				<TextField label="Name" name="name" bind:value={qaName} placeholder="e.g. Dinner out" />
				<NumberField label="Calories" name="calories" bind:value={qaCalories} decimalText suffix="kcal" required />
				<div class="grid grid-cols-3 gap-3">
					<NumberField label="Protein" name="protein" bind:value={qaProtein} decimalText suffix="g" />
					<NumberField label="Carbs" name="carbs" bind:value={qaCarbs} decimalText suffix="g" />
					<NumberField label="Fat" name="fat" bind:value={qaFat} decimalText suffix="g" />
				</div>
			</div>
			<div class="mt-4 flex gap-2">
				<Button type="button" variant="ghost" onclick={() => (quickAdd = false)}>Back</Button>
				<Button type="submit" variant="primary" full class="flex-1">Log</Button>
			</div>
		</form>
	{:else}
		<div class="mb-3 flex items-end gap-2">
			<TextField name="query" type="search" placeholder="Search food…" bind:value={query} class="flex-1" />
			<Button type="button" variant="secondary" size="icon" onclick={() => (scanOpen = true)} disabled={scanBusy}>
				<Icon name="scan" size={20} />
				<span class="sr-only">Scan barcode</span>
			</Button>
		</div>

		<div class="max-h-72 overflow-y-auto -mx-1">
			{#each mealResults as meal (meal.id)}
				<button
					type="button"
					onclick={() => pickMeal(meal)}
					class="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--color-surface-alt)] text-left"
				>
					<span class="min-w-0">
						<span class="block truncate text-[var(--color-text)]">{meal.name}</span>
						<span class="text-xs text-[var(--color-text-muted)]"
							>{Math.round(mealKcalPerPortion(meal))} kcal / portion</span
						>
					</span>
					<span class="type-pill">Meal</span>
				</button>
			{/each}
			{#each productResults as product (product.id)}
				<button
					type="button"
					onclick={() => pickProduct(product)}
					class="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--color-surface-alt)] text-left"
				>
					<span class="min-w-0">
						<span class="block truncate text-[var(--color-text)]">
							{product.name}{#if product.brand}<span class="text-[var(--color-text-muted)]"> · {product.brand}</span>{/if}
						</span>
						<span class="text-xs text-[var(--color-text-muted)]">
							{Math.round(product.calories)} kcal / {product.amount}{product.unit}
						</span>
					</span>
					<span class="type-pill">Product</span>
				</button>
			{/each}
			{#if catalogResults.length > 0}
				<p class="section-label px-3 pt-2 pb-1">From the catalog</p>
				{#each catalogResults as c (c.id)}
					<button
						type="button"
						onclick={() => pickCatalog(c)}
						disabled={addingCatalog}
						class="w-full flex items-center justify-between gap-2 px-3 py-2.5 rounded-[var(--radius-md)] hover:bg-[var(--color-surface-alt)] text-left disabled:opacity-50"
					>
						<span class="min-w-0">
							<span class="block truncate text-[var(--color-text)]">
								{c.name}{#if c.brand}<span class="text-[var(--color-text-muted)]"> · {c.brand}</span>{/if}
							</span>
							<span class="text-xs text-[var(--color-text-muted)]">{Math.round(c.calories)} kcal / {c.amount}{c.unit}</span>
						</span>
						<Icon name="plus" size={16} class="shrink-0 text-[var(--color-text-muted)]" />
					</button>
				{/each}
			{/if}

			{#if mealResults.length === 0 && productResults.length === 0 && catalogResults.length === 0}
				<p class="text-sm text-[var(--color-text-muted)] px-3 py-2">
					{term.length < 2
						? 'Search your meals, your products, and the Norwegian food catalog.'
						: 'No matches — try another spelling, or scan the barcode.'}
				</p>
			{/if}
		</div>

		<div class="mt-3 border-t border-[var(--color-border)] pt-3">
			<Button type="button" variant="ghost" full onclick={() => (quickAdd = true)}>
				<Icon name="plus" size={16} />
				Quick add — just the numbers
			</Button>
		</div>
	{/if}

	{#if error}
		<p class="mt-2 text-sm text-[var(--color-danger)]">{error}</p>
	{/if}
</Modal>

<BarcodeScanner bind:open={scanOpen} onscan={handleScan} />
