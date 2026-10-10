import { db } from '$lib/server/db';
import { meals, categories, mealCategories, mealIngredients, products } from '$lib/server/db/schema';
import { createProduct, type ProductInput } from '$lib/server/repositories/products';
import { canViewMeal } from '$lib/server/repositories/mealShares';
import { saveMealPhoto, deleteMealPhotoFile } from '$lib/server/storage/mealPhotos';
import { and, eq, inArray, like, asc, desc, sql } from 'drizzle-orm';

export type Macros = { calories: number; protein: number; carbs: number; fat: number };

export type MealIngredientView = {
	id: number;
	quantity: number;
	type: 'product' | 'meal';
	refId: number;
	name: string;
	brand?: string | null;
	/** The product's defined serving amount+unit (e.g. 100/'g') — undefined for sub-meal ingredients, which
	 *  have no single unit. quantity * amount is the real amount used, e.g. "200 g". */
	amount?: number;
	unit?: string;
	unitMacros: Macros;
	totalMacros: Macros;
};

function scaleMacros(macros: Macros, quantity: number): Macros {
	return {
		calories: macros.calories * quantity,
		protein: macros.protein * quantity,
		carbs: macros.carbs * quantity,
		fat: macros.fat * quantity
	};
}

function sumMacros(list: Macros[]): Macros {
	return list.reduce(
		(acc, m) => ({
			calories: acc.calories + m.calories,
			protein: acc.protein + m.protein,
			carbs: acc.carbs + m.carbs,
			fat: acc.fat + m.fat
		}),
		{ calories: 0, protein: 0, carbs: 0, fat: 0 }
	);
}

function normalizeQuantity(quantity: number): number {
	if (!Number.isFinite(quantity) || quantity <= 0) return 1;
	return Math.round(quantity * 100) / 100;
}

async function attachCategories<T extends { id: number }>(rows: T[]) {
	if (rows.length === 0) return rows.map((r) => ({ ...r, categories: [] as { id: number; name: string }[] }));

	const mealIds = rows.map((r) => r.id);
	const links = await db
		.select({ mealId: mealCategories.mealId, id: categories.id, name: categories.name })
		.from(mealCategories)
		.innerJoin(categories, eq(categories.id, mealCategories.categoryId))
		.where(inArray(mealCategories.mealId, mealIds));

	const byMeal = new Map<number, { id: number; name: string }[]>();
	for (const link of links) {
		const list = byMeal.get(link.mealId) ?? [];
		list.push({ id: link.id, name: link.name });
		byMeal.set(link.mealId, list);
	}

	return rows.map((r) => ({ ...r, categories: byMeal.get(r.id) ?? [] }));
}

/** Filters categoryIds down to only those actually owned by userId (defense in depth against cross-account linking). */
async function ownedCategoryIds(userId: number, categoryIds: number[]): Promise<number[]> {
	if (categoryIds.length === 0) return [];
	const rows = await db
		.select({ id: categories.id })
		.from(categories)
		.where(and(eq(categories.userId, userId), inArray(categories.id, categoryIds)));
	return rows.map((r) => r.id);
}

async function assertMealOwned(userId: number, mealId: number) {
	const [row] = await db.select({ id: meals.id }).from(meals).where(and(eq(meals.id, mealId), eq(meals.userId, userId)));
	if (!row) throw new Error('Meal not found');
}

type MacroIngredient = {
	quantity: number;
	subMealId: number | null;
	product: Macros | null;
};

/** Loads each ingredient layer once and reuses sub-recipe totals within this calculation.
 *  The maps are request-local so edits to ingredients/products are visible on the next read. */
async function computeMealMacrosBatch(mealIds: number[]): Promise<Map<number, Macros>> {
	const ingredientsByMeal = new Map<number, MacroIngredient[]>();
	let pending = [...new Set(mealIds)];
	while (pending.length) {
		for (const id of pending) ingredientsByMeal.set(id, []);
		const rows = await db
			.select({
				mealId: mealIngredients.mealId,
				quantity: mealIngredients.quantity,
				subMealId: mealIngredients.subMealId,
				product: {
					id: products.id,
					calories: products.calories,
					protein: products.protein,
					carbs: products.carbs,
					fat: products.fat
				}
			})
			.from(mealIngredients)
			.leftJoin(products, eq(products.id, mealIngredients.productId))
			.where(inArray(mealIngredients.mealId, pending))
			.orderBy(asc(mealIngredients.id));
		const next = new Set<number>();
		for (const row of rows) {
			ingredientsByMeal.get(row.mealId)!.push(row);
			if (row.subMealId != null && !ingredientsByMeal.has(row.subMealId)) next.add(row.subMealId);
		}
		pending = [...next];
	}

	const totals = new Map<number, Macros>();
	const visiting = new Set<number>();
	const compute = (id: number): Macros => {
		const cached = totals.get(id);
		if (cached) return cached;
		if (visiting.has(id)) throw new Error('A meal cannot include itself');
		visiting.add(id);
		const parts: Macros[] = [];
		for (const ing of ingredientsByMeal.get(id) ?? []) {
			if (ing.product) parts.push(scaleMacros(ing.product, ing.quantity));
			else if (ing.subMealId != null) parts.push(scaleMacros(compute(ing.subMealId), ing.quantity));
		}
		const total = sumMacros(parts);
		visiting.delete(id);
		totals.set(id, total);
		return total;
	};
	for (const id of mealIds) compute(id);
	return totals;
}

/** Sums a meal's ingredients (products directly, sub-meals recursively — bounded to depth 1 by construction). */
export async function computeMealMacros(mealId: number): Promise<Macros> {
	return (await computeMealMacrosBatch([mealId])).get(mealId)!;
}

export async function listMeals(userId: number, opts: { search?: string; categoryId?: number } = {}) {
	const { search, categoryId } = opts;

	let mealIdFilter: number[] | undefined;
	if (categoryId) {
		const rows = await db
			.select({ mealId: mealCategories.mealId })
			.from(mealCategories)
			.innerJoin(categories, eq(categories.id, mealCategories.categoryId))
			.where(and(eq(mealCategories.categoryId, categoryId), eq(categories.userId, userId)));
		mealIdFilter = rows.map((r) => r.mealId);
		if (mealIdFilter.length === 0) return [];
	}

	const conditions = [eq(meals.userId, userId)];
	if (search?.trim()) {
		const term = `%${search.trim()}%`;
		conditions.push(like(meals.name, term));
	}
	if (mealIdFilter) conditions.push(inArray(meals.id, mealIdFilter));

	const rows = await db
		.select()
		.from(meals)
		.where(and(...conditions))
		.orderBy(asc(meals.name));

	const withCategories = await attachCategories(rows);
	const totals = await computeMealMacrosBatch(rows.map((m) => m.id));
	return withCategories.map((m) => ({ ...m, totalMacros: totals.get(m.id)! }));
}

export async function recentMeals(userId: number, limit: number) {
	const rows = await db
		.select()
		.from(meals)
		.where(eq(meals.userId, userId))
		.orderBy(desc(meals.createdAt))
		.limit(limit);
	const withCategories = await attachCategories(rows);
	const totals = await computeMealMacrosBatch(rows.map((m) => m.id));
	return withCategories.map((m) => ({ ...m, totalMacros: totals.get(m.id)! }));
}

export async function getMeal(userId: number, id: number) {
	const [meal] = await db
		.select()
		.from(meals)
		.where(and(eq(meals.id, id), eq(meals.userId, userId)));
	if (!meal) return null;
	return buildMealDetail(meal);
}

/** Loads a meal for anyone allowed to VIEW it — the owner, or a user it's been shared with
 *  (see canViewMeal). Returns the same shape as getMeal plus an `isOwner` flag so the page can
 *  render read-only for recipients. Returns null when the meal doesn't exist or isn't accessible. */
export async function getMealForViewer(actingUserId: number, id: number) {
	const [meal] = await db.select().from(meals).where(eq(meals.id, id));
	if (!meal) return null;
	const isOwner = meal.userId === actingUserId;
	if (!isOwner && !(await canViewMeal(actingUserId, id))) return null;
	return { ...(await buildMealDetail(meal)), isOwner };
}

/** Builds the full detail view (categories, ingredients, macros) for an already-loaded meal row. */
async function buildMealDetail(meal: typeof meals.$inferSelect) {
	const id = meal.id;
	const [withCategories] = await attachCategories([meal]);

	const ingredientRows = await db
		.select()
		.from(mealIngredients)
		.where(eq(mealIngredients.mealId, id))
		.orderBy(asc(mealIngredients.sortOrder), asc(mealIngredients.id));

	const productIds = ingredientRows.filter((i) => i.productId != null).map((i) => i.productId!);
	const subMealIds = ingredientRows.filter((i) => i.subMealId != null).map((i) => i.subMealId!);

	const [productRows, subMealRows] = await Promise.all([
		productIds.length ? db.select().from(products).where(inArray(products.id, productIds)) : Promise.resolve([]),
		subMealIds.length ? db.select().from(meals).where(inArray(meals.id, subMealIds)) : Promise.resolve([])
	]);
	const productById = new Map(productRows.map((p) => [p.id, p]));
	const subMealById = new Map(subMealRows.map((m) => [m.id, m]));
	const subMealTotals = await computeMealMacrosBatch(subMealRows.map((m) => m.id));

	const ingredients: MealIngredientView[] = [];
	for (const ing of ingredientRows) {
		if (ing.productId != null) {
			const product = productById.get(ing.productId);
			if (!product) continue;
			const unitMacros: Macros = product;
			ingredients.push({
				id: ing.id,
				quantity: ing.quantity,
				type: 'product',
				refId: product.id,
				name: product.name,
				brand: product.brand,
				amount: product.amount,
				unit: product.unit,
				unitMacros,
				totalMacros: scaleMacros(unitMacros, ing.quantity)
			});
		} else if (ing.subMealId != null) {
			const subMeal = subMealById.get(ing.subMealId);
			if (!subMeal) continue;
			const unitMacros = subMealTotals.get(subMeal.id)!;
			ingredients.push({
				id: ing.id,
				quantity: ing.quantity,
				type: 'meal',
				refId: subMeal.id,
				name: subMeal.name,
				unitMacros,
				totalMacros: scaleMacros(unitMacros, ing.quantity)
			});
		}
	}

	const totalMacros = sumMacros(ingredients.map((i) => i.totalMacros));
	const recipePortions = withCategories.portions > 0 ? withCategories.portions : 1;
	const perPortionMacros = scaleMacros(totalMacros, 1 / recipePortions);

	return { ...withCategories, ingredients, totalMacros, perPortionMacros };
}

function normalizeRecipePortions(portions: number | undefined): number {
	if (portions === undefined || !Number.isFinite(portions) || portions <= 0) return 1;
	return Math.round(portions * 100) / 100;
}

export async function createMeal(
	userId: number,
	name: string,
	categoryIds: number[],
	portions?: number,
	notes?: string
) {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Name is required');
	const now = new Date();
	const [row] = await db
		.insert(meals)
		.values({
			name: trimmed,
			userId,
			portions: normalizeRecipePortions(portions),
			notes: notes?.trim() || null,
			createdAt: now,
			updatedAt: now
		})
		.returning();

	const validCategoryIds = await ownedCategoryIds(userId, categoryIds);
	if (validCategoryIds.length) {
		await db.insert(mealCategories).values(validCategoryIds.map((categoryId) => ({ mealId: row.id, categoryId })));
	}

	return row;
}

export async function updateMealDetails(
	userId: number,
	id: number,
	name: string,
	categoryIds: number[],
	portions?: number,
	notes?: string
) {
	const trimmed = name.trim();
	if (!trimmed) throw new Error('Name is required');
	await assertMealOwned(userId, id);

	await db
		.update(meals)
		.set({ name: trimmed, portions: normalizeRecipePortions(portions), notes: notes?.trim() || null, updatedAt: new Date() })
		.where(eq(meals.id, id));

	await db.delete(mealCategories).where(eq(mealCategories.mealId, id));
	const validCategoryIds = await ownedCategoryIds(userId, categoryIds);
	if (validCategoryIds.length) {
		await db.insert(mealCategories).values(validCategoryIds.map((categoryId) => ({ mealId: id, categoryId })));
	}
}

export async function deleteMeal(userId: number, id: number) {
	const [row] = await db
		.select({ photoFilename: meals.photoFilename })
		.from(meals)
		.where(and(eq(meals.id, id), eq(meals.userId, userId)));
	await db.delete(meals).where(and(eq(meals.id, id), eq(meals.userId, userId)));
	if (row) await deleteMealPhotoFile(row.photoFilename);
}

/** Saves `file` as the meal's photo, replacing (and cleaning up) any previous one. */
export async function setMealPhoto(userId: number, mealId: number, file: File) {
	await assertMealOwned(userId, mealId);
	const [row] = await db.select({ photoFilename: meals.photoFilename }).from(meals).where(eq(meals.id, mealId));

	const filename = await saveMealPhoto(mealId, file);
	await db.update(meals).set({ photoFilename: filename, updatedAt: new Date() }).where(eq(meals.id, mealId));
	await deleteMealPhotoFile(row?.photoFilename);
}

export async function clearMealPhoto(userId: number, mealId: number) {
	await assertMealOwned(userId, mealId);
	const [row] = await db.select({ photoFilename: meals.photoFilename }).from(meals).where(eq(meals.id, mealId));

	await db.update(meals).set({ photoFilename: null, updatedAt: new Date() }).where(eq(meals.id, mealId));
	await deleteMealPhotoFile(row?.photoFilename);
}

export async function addProductIngredient(userId: number, mealId: number, productId: number, quantity: number) {
	await assertMealOwned(userId, mealId);
	const [product] = await db
		.select({ id: products.id })
		.from(products)
		.where(and(eq(products.id, productId), eq(products.userId, userId)));
	if (!product) throw new Error('Product not found');

	const [{ maxOrder }] = await db
		.select({ maxOrder: sql<number>`coalesce(max(${mealIngredients.sortOrder}), -1)`.mapWith(Number) })
		.from(mealIngredients)
		.where(eq(mealIngredients.mealId, mealId));

	const [row] = await db
		.insert(mealIngredients)
		.values({ mealId, productId, quantity: normalizeQuantity(quantity), sortOrder: maxOrder + 1, createdAt: new Date() })
		.returning();
	return row;
}

/** Adds subMealId as an ingredient of mealId. Enforces the depth-1 nesting rule both ways: subMealId must not
 *  itself contain a sub-meal, AND mealId must not already be used as a sub-meal elsewhere (otherwise a meal that's
 *  already someone else's "flat" sub-meal could retroactively gain a sub-meal of its own, making that reference 2 deep). */
export async function addSubMealIngredient(userId: number, mealId: number, subMealId: number, quantity: number) {
	await assertMealOwned(userId, mealId);
	if (subMealId === mealId) throw new Error('A meal cannot include itself');

	const [subMeal] = await db
		.select({ id: meals.id })
		.from(meals)
		.where(and(eq(meals.id, subMealId), eq(meals.userId, userId)));
	if (!subMeal) throw new Error('Meal not found');

	const [existingSubIngredient] = await db
		.select({ id: mealIngredients.id })
		.from(mealIngredients)
		.where(and(eq(mealIngredients.mealId, subMealId), sql`${mealIngredients.subMealId} is not null`));
	if (existingSubIngredient) {
		throw new Error("That meal already contains a sub-meal, so it can't be nested further");
	}

	const [usedAsSubMealElsewhere] = await db
		.select({ id: mealIngredients.id })
		.from(mealIngredients)
		.where(eq(mealIngredients.subMealId, mealId));
	if (usedAsSubMealElsewhere) {
		throw new Error("This meal is already used as a sub-meal elsewhere, so it can't contain a sub-meal itself");
	}

	const [{ maxOrder }] = await db
		.select({ maxOrder: sql<number>`coalesce(max(${mealIngredients.sortOrder}), -1)`.mapWith(Number) })
		.from(mealIngredients)
		.where(eq(mealIngredients.mealId, mealId));

	const [row] = await db
		.insert(mealIngredients)
		.values({ mealId, subMealId, quantity: normalizeQuantity(quantity), sortOrder: maxOrder + 1, createdAt: new Date() })
		.returning();
	return row;
}

/** Creates a brand-new product and attaches it as an ingredient in one step (the "create product inline" flow). */
export async function createProductAndAddIngredient(
	userId: number,
	mealId: number,
	data: ProductInput,
	quantity: number
) {
	await assertMealOwned(userId, mealId);
	const product = await createProduct(userId, data);
	return addProductIngredient(userId, mealId, product.id, quantity);
}

export async function updateIngredientQuantity(userId: number, mealId: number, ingredientId: number, quantity: number) {
	await assertMealOwned(userId, mealId);
	await db
		.update(mealIngredients)
		.set({ quantity: normalizeQuantity(quantity) })
		.where(and(eq(mealIngredients.id, ingredientId), eq(mealIngredients.mealId, mealId)));
}

export async function removeIngredient(userId: number, mealId: number, ingredientId: number) {
	await assertMealOwned(userId, mealId);
	await db.delete(mealIngredients).where(and(eq(mealIngredients.id, ingredientId), eq(mealIngredients.mealId, mealId)));
}

/** A meal's direct product ingredients as a flat {productId, quantity} list — sub-meals never contain further
 *  sub-meals (depth-1 rule), so this is always complete without needing recursion. Used for the bulk
 *  "add this sub-meal's products to shopping" quick-add. */
export async function flatProductIngredients(mealId: number): Promise<{ productId: number; quantity: number }[]> {
	const rows = await db.select().from(mealIngredients).where(eq(mealIngredients.mealId, mealId));
	return rows.filter((r) => r.productId != null).map((r) => ({ productId: r.productId!, quantity: r.quantity }));
}

/** Resolves a meal down to a flat {productId, quantity} list, expanding any sub-meal ingredient into its own
 *  direct products (sub-meals never contain further sub-meals, so this is complete without deeper recursion).
 *  Used so "add this meal to shopping" adds its actual ingredients rather than the meal's own name. */
export async function resolveMealProducts(mealId: number): Promise<{ productId: number; quantity: number }[]> {
	const ingredients = await db.select().from(mealIngredients).where(eq(mealIngredients.mealId, mealId));
	const results: { productId: number; quantity: number }[] = [];
	for (const ing of ingredients) {
		if (ing.productId != null) {
			results.push({ productId: ing.productId, quantity: ing.quantity });
		} else if (ing.subMealId != null) {
			const subProducts = await flatProductIngredients(ing.subMealId);
			for (const sp of subProducts) {
				results.push({ productId: sp.productId, quantity: sp.quantity * ing.quantity });
			}
		}
	}
	return results;
}

/** Candidates for the "add sub-meal" picker: the user's meals that don't themselves contain a sub-meal (depth-1 rule), excluding the meal being built. */
export async function eligibleSubMeals(userId: number, excludeMealId: number) {
	const subMealParents = await db
		.select({ mealId: mealIngredients.mealId })
		.from(mealIngredients)
		.where(sql`${mealIngredients.subMealId} is not null`);
	const idsWithSubMeals = new Set(subMealParents.map((r) => r.mealId));

	const rows = await db
		.select({ id: meals.id, name: meals.name })
		.from(meals)
		.where(eq(meals.userId, userId))
		.orderBy(asc(meals.name));

	return rows.filter((m) => m.id !== excludeMealId && !idsWithSubMeals.has(m.id));
}
