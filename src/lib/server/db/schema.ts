import { integer, real, sqliteTable, text, primaryKey, index, unique, uniqueIndex, check } from 'drizzle-orm/sqlite-core';
import { sql } from 'drizzle-orm';

const timestamp = (name: string) =>
	integer(name, { mode: 'timestamp_ms' }).notNull().default(sql`(unixepoch('subsec') * 1000)`);

export const users = sqliteTable('users', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	username: text('username').notNull(),
	passwordHash: text('password_hash').notNull(),
	/** Grants access to /admin (user/instance management). Bootstrapped by promoting the earliest account
	 *  when none exists yet — see ensureAdminExists in hooks.server.ts. */
	isAdmin: integer('is_admin', { mode: 'boolean' }).notNull().default(false),
	createdAt: timestamp('created_at')
}, (t) => [uniqueIndex('users_username_lower_unique').on(sql`lower(${t.username})`)]);

export const sessions = sqliteTable('sessions', {
	id: text('id').primaryKey(),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at'),
	expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull()
}, (t) => [index('sessions_user_idx').on(t.userId)]);

export const categories = sqliteTable('categories', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: timestamp('created_at')
}, (t) => [unique('categories_user_name_unique').on(t.userId, t.name)]);

export const meals = sqliteTable('meals', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	/** How many portions/servings this recipe is designed to make — per-portion macros = total / portions. */
	portions: real('portions').notNull().default(1),
	notes: text('notes'),
	/** Filename of an optional user-uploaded photo, stored on disk (see $lib/server/storage/mealPhotos) — not a URL. */
	photoFilename: text('photo_filename'),
	brand: text('brand'),
	servingSize: text('serving_size'),
	calories: real('calories').notNull().default(0),
	protein: real('protein').notNull().default(0),
	carbs: real('carbs').notNull().default(0),
	fat: real('fat').notNull().default(0),
	fiber: real('fiber'),
	sugar: real('sugar'),
	sodium: real('sodium'),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
}, (t) => [index('meals_user_idx').on(t.userId), index('meals_name_idx').on(t.name)]);

export const mealCategories = sqliteTable('meal_categories', {
	mealId: integer('meal_id').notNull().references(() => meals.id, { onDelete: 'cascade' }),
	categoryId: integer('category_id').notNull().references(() => categories.id, { onDelete: 'cascade' })
}, (t) => [
	primaryKey({ columns: [t.mealId, t.categoryId] }),
	index('meal_categories_category_idx').on(t.categoryId)
]);

export const products = sqliteTable('products', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	brand: text('brand'),
	/** EAN/UPC from barcode scanning — lets a repeat scan match this product locally without any API lookup. */
	barcode: text('barcode'),
	/** The macros below are per `amount` `unit`s of this product (e.g. amount=100, unit='g' — a nutrition-label serving). */
	amount: real('amount').notNull().default(100),
	unit: text('unit').notNull().default('g'),
	calories: real('calories').notNull().default(0),
	protein: real('protein').notNull().default(0),
	carbs: real('carbs').notNull().default(0),
	fat: real('fat').notNull().default(0),
	fiber: real('fiber'),
	sugar: real('sugar'),
	sodium: real('sodium'),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
}, (t) => [
	index('products_user_idx').on(t.userId),
	index('products_name_idx').on(t.name),
	index('products_barcode_idx').on(t.barcode),
	check('products_unit_valid', sql`${t.unit} in ('g', 'ml', 'pcs')`)
]);

/** An ingredient in a meal's recipe: exactly one of productId/subMealId is set (enforced below and in the repo layer). */
export const mealIngredients = sqliteTable('meal_ingredients', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	mealId: integer('meal_id').notNull().references(() => meals.id, { onDelete: 'cascade' }),
	productId: integer('product_id').references(() => products.id, { onDelete: 'cascade' }),
	subMealId: integer('sub_meal_id').references(() => meals.id, { onDelete: 'cascade' }),
	quantity: real('quantity').notNull().default(1),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: timestamp('created_at')
}, (t) => [
	index('meal_ingredients_meal_idx').on(t.mealId),
	index('meal_ingredients_product_idx').on(t.productId),
	index('meal_ingredients_submeal_idx').on(t.subMealId),
	check(
		'meal_ingredients_exactly_one_ref',
		sql`(${t.productId} is not null and ${t.subMealId} is null) or (${t.productId} is null and ${t.subMealId} is not null)`
	)
]);

/** A line on the shopping list. Product-linked rows (productId set) are the ingredient-derived kind — their
 *  amount is computed live from shoppingListItemSources + the current recipe, never stored, so editing a
 *  meal's ingredient quantities is reflected automatically. name/brand/quantity are used only for manual,
 *  freeform items (productId null) which have no recipe to derive an amount from. */
export const shoppingListItems = sqliteTable('shopping_list_items', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
	name: text('name'),
	brand: text('brand'),
	quantity: integer('quantity').notNull().default(1),
	checked: integer('checked', { mode: 'boolean' }).notNull().default(false),
	createdAt: timestamp('created_at')
}, (t) => [
	index('shopping_list_user_idx').on(t.userId),
	index('shopping_list_product_idx').on(t.productId),
	uniqueIndex('shopping_list_items_user_product_unique').on(t.userId, t.productId).where(sql`${t.productId} is not null`)
]);

/** One meal's (or a direct add's, when mealId is null) contribution to a product-linked shopping list item.
 *  No amount is stored here — it's computed live at read time from the meal's current ingredient quantity,
 *  so quantities update automatically when a recipe is edited. multiplier accumulates on repeat adds. */
export const shoppingListItemSources = sqliteTable('shopping_list_item_sources', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	itemId: integer('item_id').notNull().references(() => shoppingListItems.id, { onDelete: 'cascade' }),
	mealId: integer('meal_id').references(() => meals.id, { onDelete: 'set null' }),
	/** Snapshot of the meal's name, shown only once mealId has gone null (source meal deleted). */
	mealName: text('meal_name'),
	multiplier: real('multiplier').notNull().default(1),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
}, (t) => [
	index('shopping_list_item_sources_item_idx').on(t.itemId),
	index('shopping_list_item_sources_meal_idx').on(t.mealId)
]);

/** Grants sharedWithUserId read/write access to ownerId's shopping list. */
export const shoppingListShares = sqliteTable('shopping_list_shares', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ownerId: integer('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	sharedWithUserId: integer('shared_with_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at')
}, (t) => [
	unique('shopping_list_shares_pair_unique').on(t.ownerId, t.sharedWithUserId),
	index('shopping_list_shares_owner_idx').on(t.ownerId),
	index('shopping_list_shares_shared_with_idx').on(t.sharedWithUserId)
]);

/** Grants sharedWithUserId read access to some of ownerId's meals. Scope is implied by which
 *  target column is set: both null = the whole meal library; categoryId set = every meal in that
 *  category; mealId set = that single meal. A pair can hold many grants (e.g. two categories +
 *  one meal). Access is read-only for the recipient — using a shared meal (log it, add its
 *  ingredients to your own list) writes only to the recipient's own data, never the owner's. */
export const mealShares = sqliteTable('meal_shares', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	ownerId: integer('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	sharedWithUserId: integer('shared_with_user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	mealId: integer('meal_id').references(() => meals.id, { onDelete: 'cascade' }),
	categoryId: integer('category_id').references(() => categories.id, { onDelete: 'cascade' }),
	createdAt: timestamp('created_at')
}, (t) => [
	index('meal_shares_owner_idx').on(t.ownerId),
	index('meal_shares_shared_with_idx').on(t.sharedWithUserId),
	index('meal_shares_meal_idx').on(t.mealId),
	index('meal_shares_category_idx').on(t.categoryId),
	check('meal_shares_scope_valid', sql`not (${t.mealId} is not null and ${t.categoryId} is not null)`)
]);

/** Shared, read-only catalog of Norwegian food products imported from Open Food Facts (see
 *  catalogData.ts / scripts/import-off-catalog.mjs). Global (no userId) — users search it and copy
 *  a row into their own products on demand (addCatalogProductToUser). Macros are per `amount` `unit`
 *  (always per 100 g/ml). offCode is the OFF barcode, used as the stable idempotent seed key. */
export const catalogProducts = sqliteTable('catalog_products', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	offCode: text('off_code').notNull(),
	name: text('name').notNull(),
	brand: text('brand'),
	barcode: text('barcode'),
	amount: real('amount').notNull().default(100),
	unit: text('unit').notNull().default('g'),
	calories: real('calories').notNull().default(0),
	protein: real('protein').notNull().default(0),
	carbs: real('carbs').notNull().default(0),
	fat: real('fat').notNull().default(0),
	fiber: real('fiber'),
	sugar: real('sugar'),
	sodium: real('sodium'),
	createdAt: timestamp('created_at')
}, (t) => [
	uniqueIndex('catalog_products_off_code_unique').on(t.offCode),
	index('catalog_products_name_idx').on(t.name),
	check('catalog_products_unit_valid', sql`${t.unit} in ('g', 'ml', 'pcs')`)
]);

export const exercises = sqliteTable('exercises', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	brand: text('brand'),
	muscleGroup: text('muscle_group'),
	createdAt: timestamp('created_at')
}, (t) => [unique('exercises_user_name_brand_unique').on(t.userId, t.name, t.brand)]);

export const workoutPlans = sqliteTable('workout_plans', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	name: text('name').notNull(),
	createdAt: timestamp('created_at')
}, (t) => [index('workout_plans_user_idx').on(t.userId)]);

export const planExercises = sqliteTable('plan_exercises', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	planId: integer('plan_id').notNull().references(() => workoutPlans.id, { onDelete: 'cascade' }),
	exerciseId: integer('exercise_id').notNull().references(() => exercises.id, { onDelete: 'cascade' }),
	targetSets: integer('target_sets'),
	restSeconds: integer('rest_seconds'),
	notes: text('notes'),
	/** Exercises in one plan sharing a supersetGroup are performed as a superset — back-to-back, with
	 *  rest taken only after the last exercise in the group. NULL = standalone. Rendered as A/B/C… in
	 *  plan order (see src/lib/utils/supersets.ts). */
	supersetGroup: integer('superset_group'),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: timestamp('created_at')
}, (t) => [
	index('plan_exercises_plan_idx').on(t.planId),
	index('plan_exercises_exercise_idx').on(t.exerciseId)
]);

export const workoutSessions = sqliteTable('workout_sessions', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	planId: integer('plan_id').references(() => workoutPlans.id, { onDelete: 'set null' }),
	date: text('date').notNull(),
	notes: text('notes'),
	createdAt: timestamp('created_at')
}, (t) => [index('workout_sessions_user_idx').on(t.userId), index('workout_sessions_date_idx').on(t.date)]);

export const workoutSets = sqliteTable('workout_sets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	sessionId: integer('session_id').notNull().references(() => workoutSessions.id, { onDelete: 'cascade' }),
	exerciseId: integer('exercise_id').notNull().references(() => exercises.id, { onDelete: 'cascade' }),
	order: integer('order').notNull().default(0),
	reps: integer('reps').notNull(),
	weight: real('weight').notNull().default(0),
	rpe: real('rpe'),
	notes: text('notes'),
	createdAt: timestamp('created_at')
}, (t) => [
	index('workout_sets_session_idx').on(t.sessionId),
	index('workout_sets_exercise_idx').on(t.exerciseId)
]);

/** Daily macro targets. `label` is the hook for per-day-type targets later (e.g. 'training'/'rest');
 *  v1 only ever reads and writes the 'default' row. */
export const nutritionTargets = sqliteTable('nutrition_targets', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	label: text('label').notNull().default('default'),
	calories: real('calories').notNull(),
	protein: real('protein').notNull(),
	carbs: real('carbs').notNull(),
	fat: real('fat').notNull(),
	updatedAt: timestamp('updated_at')
}, (t) => [unique('nutrition_targets_user_label_unique').on(t.userId, t.label)]);

/** The food diary. Each entry snapshots name and CONSUMED macros (already multiplied by portions) at log
 *  time, so editing/deleting a recipe never rewrites past days and a day sums with one query. mealId/
 *  productId are provenance only (at most one set; may both become null after the source is deleted). */
export const mealLogs = sqliteTable('meal_logs', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	date: text('date').notNull(),
	name: text('name').notNull(),
	brand: text('brand'),
	portions: real('portions').notNull().default(1),
	calories: real('calories').notNull(),
	protein: real('protein').notNull(),
	carbs: real('carbs').notNull(),
	fat: real('fat').notNull(),
	mealId: integer('meal_id').references(() => meals.id, { onDelete: 'set null' }),
	productId: integer('product_id').references(() => products.id, { onDelete: 'set null' }),
	createdAt: timestamp('created_at')
}, (t) => [index('meal_logs_user_date_idx').on(t.userId, t.date)]);

/** One active strength goal per exercise (upsert semantics — the UNIQUE is droppable later for goal history). */
export const exerciseGoals = sqliteTable('exercise_goals', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	exerciseId: integer('exercise_id').notNull().references(() => exercises.id, { onDelete: 'cascade' }),
	targetWeight: real('target_weight').notNull(),
	targetReps: integer('target_reps').notNull(),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
}, (t) => [unique('exercise_goals_exercise_unique').on(t.exerciseId)]);

/** Server-side cache of Open Food Facts barcode lookups (global product data, deliberately not per-user).
 *  Misses are cached too, so repeat scans of an unknown code don't re-hit the API. */
export const barcodeCache = sqliteTable('barcode_cache', {
	barcode: text('barcode').primaryKey(),
	payload: text('payload').notNull(),
	fetchedAt: timestamp('fetched_at')
});

/** Per-user display preferences + profile facts that don't belong to any single feature. One row per
 *  user, created lazily on first write; reads fall back to defaults when absent. Units are display-only —
 *  all body metrics are stored canonically (weight in kg, lengths in cm) and converted at the UI edge.
 *  heightCm powers BMI. */
export const userSettings = sqliteTable('user_settings', {
	userId: integer('user_id').primaryKey().references(() => users.id, { onDelete: 'cascade' }),
	weightUnit: text('weight_unit').notNull().default('kg'),
	lengthUnit: text('length_unit').notNull().default('cm'),
	heightCm: real('height_cm'),
	updatedAt: timestamp('updated_at')
}, (t) => [
	check('user_settings_weight_unit_valid', sql`${t.weightUnit} in ('kg', 'lb')`),
	check('user_settings_length_unit_valid', sql`${t.lengthUnit} in ('cm', 'in')`)
]);

/** Body-progress diary: one row per user per day (upsert/merge — logging weight and, later the same
 *  day, a waist measurement land on the one row). Every metric is nullable so a partial log is valid.
 *  Canonical units: weight in kg, all circumferences in cm; the UI converts to the user's preference. */
export const bodyMetrics = sqliteTable('body_metrics', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	date: text('date').notNull(),
	weightKg: real('weight_kg'),
	bodyFatPct: real('body_fat_pct'),
	neckCm: real('neck_cm'),
	chestCm: real('chest_cm'),
	waistCm: real('waist_cm'),
	hipsCm: real('hips_cm'),
	thighCm: real('thigh_cm'),
	armCm: real('arm_cm'),
	calfCm: real('calf_cm'),
	notes: text('notes'),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
}, (t) => [
	unique('body_metrics_user_date_unique').on(t.userId, t.date),
	index('body_metrics_user_date_idx').on(t.userId, t.date)
]);

/** One active body-weight goal per user (upsert semantics; the UNIQUE is droppable later for goal
 *  history, mirroring exerciseGoals). targetWeightKg is canonical kg. */
export const weightGoals = sqliteTable('weight_goals', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	targetWeightKg: real('target_weight_kg').notNull(),
	targetDate: text('target_date'),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
}, (t) => [unique('weight_goals_user_unique').on(t.userId)]);

/** Progress photos — strictly private (never shareable, unlike meals) and encrypted at rest. `filename`
 *  names an opaque AES-256-GCM ciphertext file on disk (see $lib/server/storage/progressPhotos); the
 *  real image type is `mime` and `byteSize` is the plaintext size after metadata stripping. `pose` lets
 *  the compare view line up the same angle across dates. */
export const progressPhotos = sqliteTable('progress_photos', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	date: text('date').notNull(),
	pose: text('pose'),
	filename: text('filename').notNull(),
	mime: text('mime').notNull(),
	byteSize: integer('byte_size').notNull(),
	caption: text('caption'),
	createdAt: timestamp('created_at')
}, (t) => [
	index('progress_photos_user_date_idx').on(t.userId, t.date),
	check('progress_photos_pose_valid', sql`${t.pose} is null or ${t.pose} in ('front', 'side', 'back')`)
]);

/** --- Peptides -------------------------------------------------------------------------------------
 *  A medication-adherence log for injectable peptide protocols. Health-sensitive and, like progress
 *  photos, **strictly private (never shareable) and encrypted at rest** — but here the data is
 *  structured, not a file. Every column that reveals WHAT the user takes (compound name, category,
 *  dose, injection site, schedule, vial contents, free-text notes) is packed into an AES-256-GCM
 *  `enc` blob (base64; see $lib/server/crypto/fieldCrypto), decrypted only inside the userId-scoped
 *  repository layer. Cleartext columns are limited to what scoping, FK joins and date-range/calendar
 *  reads actually need — `date` alone, without the compound/dose that sit in `enc`, is low-sensitivity.
 *  Consequences of that choice: adherence %, "due today", cycle state and the body-weight overlay are
 *  all computed in TypeScript after decrypt, never in SQL, and name-uniqueness is enforced in the repo
 *  (the plaintext name never reaches a column an index could cover). Volumes are tiny (one user's
 *  doses are hundreds of rows), so loading + decrypting a user's set in memory is fine. */
export const peptides = sqliteTable('peptides', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	/** Encrypted JSON payload: { name, category, vialMg, notes }. AAD-bound to `${userId}:peptides`.
	 *  vialMg here is display-only reference metadata on the compound itself (e.g. "usually comes as a 5mg
	 *  vial") — the mg/route-agnostic math always runs off a specific peptideVials row, never this field. */
	enc: text('enc').notNull(),
	/** Cleartext lifecycle flag so the active catalog lists without decrypting; contents stay in enc. */
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	sortOrder: integer('sort_order').notNull().default(0),
	createdAt: timestamp('created_at')
}, (t) => [index('peptides_user_idx').on(t.userId)]);

/** The protocol/template (the "plan" side, mirroring workoutPlans). Drives the derived due-today list
 *  and cycle state. All the schedule detail lives in `enc` — computing what's due requires decrypting
 *  the handful of active protocols, which is cheap. */
export const peptideProtocols = sqliteTable('peptide_protocols', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	peptideId: integer('peptide_id').notNull().references(() => peptides.id, { onDelete: 'cascade' }),
	/** Encrypted JSON: { doseMcg, route, frequency, weekdayMask, timeOfDay, cycleWeeksOn, cycleWeeksOff,
	 *  endDate, rotateSites, notes }. AAD-bound to `${userId}:peptide_protocols`. `route` is any AdminRoute,
	 *  not just injection — see $lib/utils/peptides.ts. */
	enc: text('enc').notNull(),
	/** Cleartext so protocols can be ordered/filtered by start without decrypting; low-sensitivity alone. */
	startDate: text('start_date').notNull(),
	active: integer('active', { mode: 'boolean' }).notNull().default(true),
	createdAt: timestamp('created_at'),
	updatedAt: timestamp('updated_at')
}, (t) => [
	index('peptide_protocols_user_idx').on(t.userId),
	index('peptide_protocols_peptide_idx').on(t.peptideId)
]);

/** Inventory: one container of peptide, of whatever physical form. Powers the reconstitution/delivery
 *  calculators, expiry alerts and "running low". Contents are in `enc`; only the depleted flag is
 *  cleartext. Table name kept as peptideVials — renaming would cost a migration for no behavioral gain —
 *  but a row's `form` need not be a vial at all; nasal_spray/serum/capsules/patches rows live here too. */
export const peptideVials = sqliteTable('peptide_vials', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	peptideId: integer('peptide_id').notNull().references(() => peptides.id, { onDelete: 'cascade' }),
	/** Encrypted JSON: { vialMg, bacWaterMl, reconstitutedAt, expiresAt, notes, form, concentrationMgMl,
	 *  percentWv, actuationVolumeUl, primingActuations, unitCount, unitMassMcg }. AAD `${userId}:peptide_vials`.
	 *  `form` defaults to 'vial' when absent (rows written before multi-route support) — see
	 *  repositories/peptideVials.ts decode(). vialMg/bacWaterMl are 'vial'-form's own fields but are reused
	 *  as an optional self-mix path for nasal_spray too (mg powder / mL diluent ⇒ mg/mL), mirroring the
	 *  reconstitution math above; concentrationMgMl/percentWv are the direct-entry alternative for
	 *  pre-made liquids. actuationVolumeUl + primingActuations size a spray/pump/drop container
	 *  (see $lib/utils/delivery.ts); unitCount/unitMassMcg describe whole-unit containers (capsules, patches). */
	enc: text('enc').notNull(),
	depleted: integer('depleted', { mode: 'boolean' }).notNull().default(false),
	createdAt: timestamp('created_at')
}, (t) => [index('peptide_vials_user_idx').on(t.userId)]);

/** The dose log (the "actuals" side, mirroring workoutSessions/bodyMetrics). Snapshots the dose in `enc`
 *  at log time so editing a protocol never rewrites history. peptideId/protocolId/vialId are cleartext
 *  provenance (a bare FK id reveals grouping, not identity — you can't tell what compound it is without
 *  decrypting the peptide row); `date` is cleartext to drive the adherence calendar without bulk decrypt. */
export const peptideDoses = sqliteTable('peptide_doses', {
	id: integer('id').primaryKey({ autoIncrement: true }),
	userId: integer('user_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
	peptideId: integer('peptide_id').notNull().references(() => peptides.id, { onDelete: 'cascade' }),
	protocolId: integer('protocol_id').references(() => peptideProtocols.id, { onDelete: 'set null' }),
	vialId: integer('vial_id').references(() => peptideVials.id, { onDelete: 'set null' }),
	date: text('date').notNull(),
	/** Encrypted JSON: { doseMcg, site, route, time, measureCount, measureUnit, kind, notes }. AAD
	 *  `${userId}:peptide_doses`. doseMcg is always the canonical, cross-comparable figure; measureCount +
	 *  measureUnit separately preserve what the user actually did (e.g. "2 sprays") — see
	 *  $lib/utils/delivery.ts. `kind: 'prime'` marks a priming actuation that drew down a container without
	 *  being an actual dose, so it's excluded from adherence (see repositories/peptideDoses.ts). Rows written
	 *  before multi-route support have neither field and decode as measureUnit 'unit' / kind 'dose', with
	 *  measureCount falling back to the older `unitsShown` key — see decode(). */
	enc: text('enc').notNull(),
	createdAt: timestamp('created_at')
}, (t) => [
	index('peptide_doses_user_date_idx').on(t.userId, t.date),
	index('peptide_doses_peptide_idx').on(t.peptideId)
]);
