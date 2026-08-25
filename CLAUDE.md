# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A self-hosted, multi-user PWA for tracking meals/macros, a shopping list tied to the meal
library, and strength training. SvelteKit (Svelte 5, runes mode) + TypeScript, single Node
process serving UI and API, SQLite via Drizzle ORM (`better-sqlite3`). No auth dependency —
sessions and password hashing (`scrypt`) are hand-rolled in `src/lib/server/auth.ts`. Tailwind
CSS v4, design tokens as CSS variables in `src/routes/layout.css`. No charting library — the
progress chart in `src/lib/components/workouts/ProgressChart.svelte` is hand-rolled inline SVG.

## Commands

```sh
npm install
cp .env.example .env         # DATABASE_URL=local.db is already dev-appropriate
npm run db:push              # create/update local SQLite schema from schema.ts (dev only)
npm run dev                  # start dev server

npm run check                # svelte-kit sync + svelte-check (type checking)
npm run check:watch

npm run db:generate          # generate a versioned SQL migration after editing schema.ts
npm run db:studio            # Drizzle Studio GUI against the local DB

npm run build && npm run preview
```

There is no test suite and no lint script configured — `npm run check` (svelte-check) is the
only verification step available.

Requires Node.js 22+. Docker Compose is the intended production path (`docker compose up -d
--build`); migrations run automatically on container start via `scripts/migrate.js`.

## Architecture

**Data flow:** routes only. Every `+page.server.ts` `load`/`actions` function calls into
`src/lib/server/repositories/*.ts` — never touches `db` or `schema` directly. Each repository
file owns one domain (meals, products, workouts, shoppingList, etc.) and takes a `userId` as
the first argument for scoping; there is no ORM-level row security, so a repository function
that forgets to filter by `userId` is a cross-account data leak. The **one deliberate exception**
is `repositories/admin.ts`: its queries are un-scoped (they read across all users) precisely
because it powers the admin panel, so it must only ever be reached behind the admin gate — every
`/admin` action re-checks `locals.user.isAdmin` right next to the un-scoped call. It manages
accounts and shows aggregates; it never exposes another user's private *content* (a progress photo
is still only served by the owner-only route).

**Auth:** `src/hooks.server.ts` is the single gate — it resolves the session cookie to a user
on every request via `getSessionUser`, sets `event.locals.user`, and redirects unauthenticated
requests to `/login` except for the small `PUBLIC_PATHS` allowlist. Route code reads
`locals.user` (non-null by the time a protected route runs) rather than re-checking auth.
Sessions are opaque random tokens in the `sessions` table (1 year expiry), not JWTs.
`users.isAdmin` gates `/admin` (hooks redirects non-admins; the `/admin` layout + every action
re-check). `ensureAdminExists` (run at startup from hooks) promotes the earliest account if no
admin exists, so the first-registered user becomes admin automatically.

**Schema** (`src/lib/server/db/schema.ts`, ~20 tables) has three domains that share the same
sharing/ownership pattern:
- **Meals**: `meals` → `mealIngredients` (a meal's ingredients are either a `product` or
  another `meal`, distinguished by a `type` discriminator + `refId`) → `mealCategories` for
  tagging. `mealShares` grants another account read access to a meal.
- **Shopping list**: `shoppingListItems` with `shoppingListItemSources` tracking which meals
  contributed a quantity (so removing a meal's ingredient decrements rather than deletes the
  merged line item). `shoppingListShares` grants another account access to your list.
- **Workouts**: `workoutPlans` → `planExercises` (template), separate from logged
  `workoutSessions` → `workoutSets` (actuals). `exerciseGoals` tracks per-exercise targets.
  `workoutGroups`/`workoutGroupMembers` let separate users train together: unlike the owner→viewer
  meal/shopping-list shares, this is symmetric — inviting someone (by username, from a session's
  "Train together" panel) creates a group and a pending membership row; accepting clones the
  inviter's session (same date/plan) into the acceptor's *own* account and links it in, so every
  member still only ever writes their own `workoutSessions`/`workoutSets`/`exercises`. The session
  screen polls `listTrainingPartners` (`$lib/server/repositories/workoutGroups.ts`) for live
  set/exercise counts from the other members' sessions.
- **Body**: `bodyMetrics` (one upsert row per user per day: weight + circumferences, all canonical
  kg/cm, all nullable), `weightGoals` (one per user), `userSettings` (display units + height for BMI),
  and `progressPhotos`. Progress photos are **strictly private (never shared) and encrypted at rest** —
  the on-disk file is AES-256-GCM ciphertext (`$lib/server/crypto/photoCrypto`, key from
  `PHOTO_ENCRYPTION_KEY`), written by `$lib/server/storage/progressPhotos` after EXIF/metadata stripping
  (`$lib/server/storage/images`), and only ever decrypted in the ownership-checked serve route
  `routes/body/photos/[id]/file`. Don't add sharing or a non-encrypted path for these.
- **Peptides**: a medication-adherence log — `peptides` (compound catalog) → `peptideProtocols` (the
  "plan" template: dose/schedule/optional loading phase, editable in place at any time, even after it's
  gone active — there's no lock) and `peptideVials` (inventory containers, any form: vial/nasal_spray/
  serum/capsules/patches), separate from logged `peptideDoses` (the "actuals", one row per admin/prime/
  removal event). All four are **strictly private and encrypted at rest field-by-field** — every
  sensitive column is an AES-256-GCM JSON blob (`enc`, via `$lib/server/crypto/fieldCrypto`, same
  `PHOTO_ENCRYPTION_KEY`), decrypted only inside the userId-scoped repository; cleartext columns are
  limited to FK/date-range scoping. Protocols and compounds have full create/update UI; vials and doses
  are also fully editable in place (`updateVial`/`updateDose`) — logging or reconstituting something
  wrong isn't a delete-and-redo. `peptidePhotos` is a `progressPhotos`-shaped photo gallery scoped to a
  peptide (or general, if unset) — same whole-file `photoCrypto` encryption, own `storage/peptidePhotos`
  + owner-checked serve route (`routes/peptides/photos/[id]/file`), reusing `photoCrypto` as-is rather
  than adding a peptide-specific variant.

`products` (user-owned) and `catalogProducts` (shared global product catalog, seeded from Open
Food Facts data — see `presetData.ts`/`presets.ts`/`catalogData.json`) are distinct tables;
`src/routes/api/catalog/*` lets a user copy a catalog product into their own `products`.
`barcodeCache` caches OFF barcode lookups (`src/routes/api/barcode/[code]`).

**Migrations:** `schema.ts` is the source of truth. After editing it, run `npm run db:generate`
to produce a versioned SQL file in `drizzle/` — commit that file. `db:push` is dev-only
schema-sync and must never be used as a substitute for a generated migration in a real change.

> **FK caveat (schema.ts ≠ migrations):** for `categories`, `exercises`, `meals`, and
> `workout_sessions`, `schema.ts` declares `user_id ... onDelete: 'cascade'`, but the **migration-built
> schema has `NO ACTION`** (the cascade was never generated into a migration). So `db:push` dev DBs
> cascade while migration-built (prod) DBs don't — and a plain `DELETE FROM users` throws a FOREIGN KEY
> error on prod. `admin.deleteUser` therefore deletes a user's rows **explicitly, child→parent, in a
> transaction** rather than trusting cascade. If you ever add a new user-owned table, add it to that
> deletion list. (All other user FKs — sessions, products, body/photos, etc. — are genuinely cascade.)

**Validation:** minimal and centralized — `src/lib/server/validation.ts` only covers
username/password rules. Other input validation happens inline in the relevant
`+page.server.ts` action or repository function; there's no shared schema-validation library
(no zod/valibot).

## Deployment

`proxmox/fitness-tracker.sh` is a standalone installer styled after (but not integrated with)
the community-scripts.org Proxmox VE Helper-Scripts framework, since this repo isn't in their
catalog. It's meant to be run on a Proxmox host to provision an LXC, install Docker, and deploy
the app — see the script's own header comments for `REPO_URL`/`APP_DIR`/`APP_PORT` overrides.

The app is explicitly designed for a trusted private network (Tailscale/LAN/VPN) — signup has
no invite codes, email verification, or rate limiting. Don't add internet-facing hardening
speculatively; that's a deliberate scope boundary, not an oversight. The one place extra hardening
*is* warranted is progress photos: they protect **data at rest** (stolen volume/backup, EXIF-GPS
leakage, another local account) rather than the network perimeter, so their encryption + metadata
stripping + owner-only access is in scope, not a contradiction of the boundary above.
