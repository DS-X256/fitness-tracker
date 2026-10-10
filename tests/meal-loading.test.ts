import { beforeAll, afterAll, it, expect, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const dir = mkdtempSync(path.join(tmpdir(), 'fitness-optimization-'));
process.env.DATABASE_URL = path.join(dir, 'test.db');
let db: typeof import('../src/lib/server/db').db;
let meals: typeof import('../src/lib/server/repositories/meals');
let productId: number;
let childId: number;
let emptyId: number;
beforeAll(async () => {
	execFileSync(process.execPath, ['scripts/migrate.js'], { env: process.env });
	({ db } = await import('../src/lib/server/db'));
	meals = await import('../src/lib/server/repositories/meals');
	const sql = db.$client;
	sql.prepare('INSERT INTO users(id,username,password_hash) VALUES (1,?,?), (2,?,?)').run('owner', 'fixture', 'other', 'fixture');
	productId = Number(sql.prepare('INSERT INTO products(user_id,name,calories,protein,carbs,fat) VALUES (1,?,100,10,20,5)').run('Ingredient').lastInsertRowid);
	const addMeal = sql.prepare('INSERT INTO meals(user_id,name) VALUES (?,?)');
	childId = Number(addMeal.run(1, 'Shared sub-recipe').lastInsertRowid);
	emptyId = Number(addMeal.run(1, 'Empty recipe').lastInsertRowid);
	sql.prepare('INSERT INTO meal_ingredients(meal_id,product_id,quantity) VALUES (?,?,2)').run(childId, productId);
	for (let n = 0; n < 120; n++) {
		const id = Number(addMeal.run(1, `Recipe ${String(n).padStart(3, '0')}`).lastInsertRowid);
		sql.prepare('INSERT INTO meal_ingredients(meal_id,product_id,quantity) VALUES (?,?,1)').run(id, productId);
		sql.prepare('INSERT INTO meal_ingredients(meal_id,sub_meal_id,quantity) VALUES (?,?,0.5)').run(id, childId);
	}
	addMeal.run(2, 'Private other recipe');
});
afterAll(() => {
	db?.$client.close();
	rmSync(dir, { recursive: true, force: true });
});
it('loads a large meal library with accurate nested totals and scoped results', async () => {
	const prepare = vi.spyOn(db.$client, 'prepare');
	const rows = await meals.listMeals(1);
	const queries = prepare.mock.calls.length;
	prepare.mockRestore();
	expect(queries).toBeLessThanOrEqual(4);
	expect(rows).toHaveLength(122);
	expect(rows.find((m) => m.id === emptyId)?.totalMacros).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
	expect(rows.filter((m) => m.name.startsWith('Recipe ')).every((m) => m.totalMacros.calories === 200 && m.totalMacros.protein === 20)).toBe(true);
	expect(rows.some((m) => m.userId !== 1)).toBe(false);
});
it('recomputes after ingredient edits and handles filtered and recent lists', async () => {
	const filtered = await meals.listMeals(1, { search: 'Recipe 000' });
	expect(filtered).toHaveLength(1);
	expect(filtered[0].totalMacros.calories).toBe(200);
	db.$client.prepare('UPDATE products SET calories=150 WHERE id=?').run(productId);
	expect((await meals.listMeals(1, { search: 'Recipe 000' }))[0].totalMacros.calories).toBe(300);
	expect((await meals.computeMealMacros(childId)).calories).toBe(300);
	expect(await meals.listMeals(1, { search: 'no match' })).toEqual([]);
	expect(await meals.listMeals(2)).toHaveLength(1);
	const recent = await meals.recentMeals(1, 3);
	expect(recent).toHaveLength(3);
	expect(recent.every((m) => m.totalMacros.calories === (m.id === emptyId ? 0 : 300))).toBe(true);
	const detail = await meals.getMeal(1, filtered[0].id);
	expect(detail?.totalMacros).toEqual({ calories: 300, protein: 20, carbs: 40, fat: 10 });
	expect(detail?.ingredients.find((i) => i.type === 'meal')?.unitMacros.calories).toBe(300);
	expect(await meals.getMeal(2, filtered[0].id)).toBeNull();
	expect(await meals.getMealForViewer(2, filtered[0].id)).toBeNull();
});

it('preserves category filtering and returns zero totals for empty recipes', async () => {
	const categoryId = Number(db.$client.prepare('INSERT INTO categories(user_id,name) VALUES (1,?)').run('Selected').lastInsertRowid);
	db.$client.prepare('INSERT INTO meal_categories(meal_id,category_id) VALUES (?,?)').run(emptyId, categoryId);
	const rows = await meals.listMeals(1, { categoryId });
	expect(rows.map((m) => m.id)).toEqual([emptyId]);
	expect(rows[0].categories).toEqual([{ id: categoryId, name: 'Selected' }]);
	expect(rows[0].totalMacros).toEqual({ calories: 0, protein: 0, carbs: 0, fat: 0 });
	expect(await meals.listMeals(2, { categoryId })).toEqual([]);
});
