# Fitness Tracker — Project Review

_Prepared by a full read-through of the repository at commit `06a45b0` (branch `main`), 79 commits,
2026-07-18 → 2026-09-04. No code was changed as part of this review._

---

## 1. Overall status

This is a **mature, unusually well-documented codebase** for its size (~15k LOC across ~150
TypeScript/Svelte files). It reads like it was built carefully and iteratively: consistent
conventions, extensive doc-comments that explain *why* not just *what*, deliberate and clearly
justified security trade-offs (encryption design, SSRF guards, admin-query scoping), and no
half-finished features — a search for `TODO`/`FIXME`/`HACK`/stub markers came back empty.

The biggest structural gaps are **process**, not code: there is no automated test suite of any
kind (only `svelte-check` type-checking) and no linter. Given the amount of non-trivial pure logic
in the codebase (crypto, unit math, dose scheduling, recipe parsing), that's the single highest-
leverage investment available. Everything else found below is small and localized — a handful of
concrete bugs/inconsistencies, one real privacy gap (unstripped meal-photo metadata), and the usual
list of polish items.

**Nothing found here blocks normal use.** The one item worth fixing promptly is the meal-photo
metadata gap (§2.1), since it's a quiet contradiction of the app's own stated privacy design and is
a one-line fix.

---

## 2. Critical findings

### 2.1 Meal photos are not stripped of EXIF/GPS metadata (privacy gap) — **High**

`src/lib/server/storage/mealPhotos.ts` (`saveMealPhoto`) writes the uploaded buffer straight to
disk after only a magic-byte format sniff:

```ts
// src/lib/server/storage/mealPhotos.ts:19-30
export async function saveMealPhoto(mealId: number, file: File): Promise<string> {
  if (file.size > MAX_PHOTO_BYTES) throw new Error('Photo must be under 8 MB');
  const buffer = Buffer.from(await file.arrayBuffer());
  const ext = sniffImageExt(buffer);
  if (!ext) throw new Error('Photo must be a JPEG, PNG, or WebP image');
  await mkdir(UPLOADS_DIR, { recursive: true });
  const filename = `${mealId}-${randomBytes(8).toString('hex')}.${ext}`;
  await writeFile(mealPhotoPath(filename), buffer);
  return filename;
}
```

Compare this with `storage/progressPhotos.ts` and `storage/peptidePhotos.ts`, which both call
`stripImageMetadata()` before writing. `stripImageMetadata` already exists in
`src/lib/server/storage/images.ts` and is format-aware for exactly these three formats — the fix
is a one-line addition, no new dependency.

This matters more than it looks: meal photos are the **one photo type in the app that can be
shared with another account** (`mealShares`, `ShareMealsModal.svelte`). A phone photo of a home-
cooked meal frequently still carries the phone's GPS coordinates in EXIF; sharing that meal shares
the coordinates of wherever it was cooked/photographed with another user on the instance. The
app's own documented philosophy (README "Security notes", CLAUDE.md) treats metadata-stripping as
a blanket rule for uploaded photos — this is the one path that was missed.

**Fix:** call `stripImageMetadata(buffer, ext)` before `writeFile`, exactly as the other two photo
pipelines do. Effort: S (minutes).

### 2.2 `cookie@0.6.0` — low-severity transitive vulnerability in a production dependency

`npm audit` (against `package-lock.json`) reports 7 advisories. Six are inside `drizzle-kit`'s
bundled `esbuild` — a **devDependency only**, never present in the production image (the
Dockerfile's runtime stage runs `npm ci --omit=dev` and copies only `build/`, so this never ships).

The one that does ship: `@sveltejs/kit@2.70.3` (current, matches `^2.63.0`) depends on
`cookie@0.6.0`, which has a low-severity advisory (GHSA-pxg6-pf52-xh8x — accepts out-of-bounds
characters in a cookie's name/path/domain). There is currently no non-breaking upstream fix
(`npm audit fix --force` wants to downgrade `@sveltejs/kit` to a pre-1.0 release, which is not a
real fix path). This is worth tracking against future SvelteKit releases rather than acting on now.

### 2.3 No login throttling / lockout — accepted risk, flagged for completeness

`src/routes/login/+page.server.ts` has no rate limiting, and passwords only need to be 8+ characters
with no complexity check (`src/lib/server/validation.ts`). This is a **documented, deliberate**
scope boundary (CLAUDE.md: "explicitly designed for a trusted private network... Don't add
internet-facing hardening speculatively"), so it's not a bug — but it's worth restating here since
it's the kind of thing that's easy to forget was a decision rather than an oversight. If this app
is ever exposed beyond a household's own network, this is the first thing to revisit. A minimal,
cheap improvement that wouldn't conflict with the app's philosophy: a simple in-memory
per-username/IP backoff on repeated failed logins (no new dependency, no UX cost for normal use).

---

## 3. What's done well (worth calling out, not just critiquing)

- **Encryption design** (`fieldCrypto.ts`, `photoCrypto.ts`): AES-256-GCM, HKDF-derived per-record
  subkeys with domain separation, AAD bound to `${userId}:${table/filename}` so a ciphertext can't
  be relocated across users or tables, fail-closed when the key is absent. This is genuinely
  careful crypto engineering for a self-hosted app.
- **SSRF hardening** in `recipeImport.ts`: numeric IP classification (catches obfuscated literals
  like `0x7f000001`), resolves-then-checks DNS (not just string matching the hostname), re-validates
  every redirect hop by hand instead of trusting `fetch`'s `redirect: 'follow'`. The code even
  documents its own residual gap (DNS-rebinding TOCTOU) rather than overclaiming.
- **Auth**: timing-safe password comparison, scrypt with a per-user salt, opaque random session
  tokens (not JWTs), sessions invalidated instance-wide on password reset.
- **Admin isolation**: the one place that runs un-scoped cross-user queries (`repositories/admin.ts`)
  is clearly called out in its own header comment and every action re-checks `isAdmin` right next
  to the query, rather than trusting the layout guard alone.
- **Photo serving**: both progress- and peptide-photo file routes return `404` (never `401`/`403`)
  for both "doesn't exist" and "not yours," and set `nosniff` + `Content-Security-Policy: default-src
  'none'` + `no-store` — a thoughtful response to a small but real leak vector (cache/error-message
  fingerprinting).
- **FK-cascade caveat handled correctly**: the schema declares `onDelete: 'cascade'` but the authors
  noticed the *migration-generated* schema doesn't actually carry it for several tables, and
  `admin.deleteUser` does an explicit, documented, child→parent transactional delete instead of
  trusting cascade. This is the kind of drift that normally goes unnoticed until it breaks in
  production.
- **No dead/half-finished features.** Every domain (meals, shopping, workouts, body, peptides, AI)
  has complete CRUD and a working UI; nothing is stubbed out.

---

## 4. Recommended improvements

### 4.1 Code / Architecture

| # | Finding | Where | Effort |
|---|---|---|---|
| A1 | `ExercisePicker.svelte` and `PlanExercisePicker.svelte` are ~70% identical (search/filter list, inline "create new exercise" form, `subtitle()` helper) — `PlanExercisePicker` just adds a second step. Worth extracting the shared search/create UI into one component or snippet. | `src/lib/components/workouts/{ExercisePicker,PlanExercisePicker}.svelte` | M |
| A2 | Dead/no-op code: `fmtWeight(n) { return n; }` in the dashboard — an identity function called on every weight display, presumably meant to route through the kg/lb conversion (see A4) but never finished. | `src/routes/+page.svelte:31-33` | S |
| A3 | Stale planning document committed at repo root: describes making the peptide tracker "route-aware," but that work is already fully shipped (`AdminRoute`, `ContainerForm`, multi-route `LogDoseModal` all exist in `src/lib/utils/peptides.ts`). Dead documentation clutter — delete it or move it to a `/docs` archive folder. | `PEPTIDE_MULTIROUTE_PROMPT.md` | S |
| A4 | `userSettings.weightUnit` (kg/lb) is honored only for body-tracker weights (`$lib/utils/units.ts` is imported only by `routes/body/*`). Workout weights (sets, 1RM, goals, plan targets) are hardcoded to kg display everywhere else (`SetRow.svelte`, `QuickEntryRow.svelte`, exercise-goal cards). A user who sets their preference to lb still sees squat/bench numbers in kg. | `src/lib/components/workouts/*`, `src/lib/utils/units.ts` | M |
| A5 | N+1 query patterns: `listMeals`/`recentMeals` call `computeMealMacros()` per meal (each of which does its own ingredient/product/sub-meal queries), and `listShoppingList` resolves each distinct source meal's current ingredients in a per-meal loop rather than batching. Not a problem at the app's stated household scale, but will show up if someone's meal library grows into the hundreds. | `src/lib/server/repositories/meals.ts`, `shoppingList.ts` | M |
| A6 | No ESLint/Prettier config. Style consistency today relies entirely on manual discipline (which is unusually good, but nothing catches an unused import, a stray `console.log`, or an accidental convention break mechanically). | repo root | S–M |

### 4.2 UI / UX

| # | Finding | Where | Effort |
|---|---|---|---|
| U1 | The signup page shows the app's bottom navigation (Home / Meals / Shopping / Workouts / Health / Coach) even though the visitor isn't authenticated — every one of those links just bounces back to `/login`. The chrome-visibility check only excludes `/login`, not `/signup`. | `src/routes/+layout.svelte:9` (`showChrome = pathname !== '/login'`) | S |
| U2 | The shared `Modal.svelte` — used by essentially every dialog in the app (meal logging, ingredient pickers, all "add/edit" flows) — has no `role="dialog"`/`aria-modal="true"` and does no focus management (no auto-focus on open, no focus trap, no focus restoration on close). Escape-to-close is handled, which is good, but a keyboard or screen-reader user can currently tab out of an open modal into the page behind it. Because it's one shared component, fixing it here fixes every modal in the app at once. | `src/lib/components/Modal.svelte` | M |
| U3 | ARIA attributes (`aria-*`, `role`, `alt`) appear in only ~25 of the ~63 components. Clickable elements are consistently real `<button>`/`<a>` tags (good — no `<div onclick>` pattern found anywhere), but things like the hand-rolled `ProgressChart`/`BodyTrendChart` SVGs and the photo galleries/lightbox likely have no text equivalent for screen-reader users. Recommend a focused accessibility pass rather than a blanket audit. | `src/lib/components/workouts/ProgressChart.svelte`, `body/BodyTrendChart.svelte`, `PhotoLightbox.svelte` | M |
| U4 | Design-system polish is genuinely above average for a solo/small-team project: a coherent warm-neutral/terracotta token system, correct three-state theming (explicit choice vs. `prefers-color-scheme` vs. default), safe-area-inset handling for notched phones, and `prefers-reduced-motion` respected in the shared `Modal`. No action needed — noted so it isn't lost in a list of critiques. | `src/routes/layout.css`, `Modal.svelte` | — |

### 4.3 Functionality

| # | Suggestion | Rationale | Effort |
|---|---|---|---|
| F1 | In-app data export (JSON/CSV of a user's own meals, logs, workouts) | Today the only backup path is copying the raw SQLite file out of the Docker volume, which is fine for the operator but invisible to non-technical household members who might want their own copy. | M |
| F2 | Extend the kg/lb display preference to workout weights (see A4) | Currently a functionality gap, not just cosmetic, for anyone who set their preference to lb. | M |
| F3 | Optional reminders/notifications (e.g. "peptide dose due today," "log today's weight") | The app is already installed as a home-screen PWA with a service worker; a Push API opt-in would close the loop on the adherence-tracking features that already compute "due today." | M–L |
| F4 | Manual ingredient-paste fallback for recipe import | `recipeImport.ts` only succeeds when a page publishes schema.org `Recipe` JSON-LD; sites that don't will currently fail outright ("no recipe found"). A manual paste-and-parse fallback would reuse the existing `parseIngredientLine`/`candidateTerms` parsing already built for this. | M |

### 4.4 Performance

Covered above (A5 — N+1 macro/shopping-list resolution). No other meaningful performance concerns
found: queries are indexed appropriately (every `userId`/date-scoped table has the matching index),
there's no heavy client-side computation, and the AI features are properly server-side, quota-
gated, and cached (weekly digest, body/nutrition insights, peptide research all cache their
results rather than re-calling the API).

### 4.5 Testing

This is the largest structural gap. There is **no test framework configured at all** — `npm run
check` (svelte-check, type-checking only) is the sole automated gate, confirmed in both
`package.json` and `CLAUDE.md`. The codebase has a substantial amount of pure, easily-unit-testable
logic that currently has zero coverage:

- Crypto round-trips (`fieldCrypto.ts`, `photoCrypto.ts`) — encrypt/decrypt, AAD-mismatch rejection,
  key-rotation-absence behavior.
- Macro math (`meals.ts`'s `scaleMacros`/`sumMacros`/`computeMealMacros` recursion, portion scaling).
- Reconstitution/delivery math (`utils/reconstitution.ts`, `utils/delivery.ts`) — exactly the kind
  of arithmetic where a silent unit error is a real-world hazard given what it's calculating.
- Peptide scheduling/adherence (`utils/peptideSchedule.ts`) — weekday masks, on/off cycles.
- `recipeImport.ts`'s SSRF guard (`isBlockedIpv4`/`isBlockedIpv6`) — security-relevant logic that
  is currently only validated by code review, not by a regression test.
- `parseDecimal`/`isoDate` utilities used throughout forms.

None of these require a running server or database, so a lightweight unit-test setup (e.g. Vitest,
which is what SvelteKit projects conventionally reach for) could cover a meaningful fraction of the
app's risk surface without touching the "no test suite" architecture decision's spirit much —
this would be additive, not a rewrite of process.

---

## 5. Prioritized action list

| Priority | Item | Area | Effort |
|---|---|---|---|
| **High** | Strip EXIF/GPS metadata from meal photos (§2.1) | Security/privacy | S |
| **High** | Add `role="dialog"`/`aria-modal` + focus trap to shared `Modal.svelte` (U2) | Accessibility | M |
| **High** | Hide bottom nav on `/signup` (U1) | UX bug | S |
| Medium | Introduce a unit-test suite (Vitest) starting with crypto, macro math, delivery/reconstitution math, SSRF guard (§4.5) | Testing | M–L |
| Medium | Extend kg/lb display preference to workout weights (A4/F2) | Consistency/Functionality | M |
| Medium | De-duplicate `ExercisePicker`/`PlanExercisePicker` (A1) | Code quality | M |
| Medium | Accessibility pass on charts/photo galleries (U3) | Accessibility | M |
| Medium | In-app data export for end users (F1) | Functionality | M |
| Low | Remove dead `fmtWeight` no-op or finish its purpose (A2) | Code cleanliness | S |
| Low | Delete/archive `PEPTIDE_MULTIROUTE_PROMPT.md` (A3) | Repo hygiene | S |
| Low | Bump `@anthropic-ai/sdk` (0.121→0.124), `@fontsource/*` (5.2→5.3), `better-sqlite3` patch (12.10→12.11.1) | Dependencies | S |
| Low | Add ESLint/Prettier config (A6) | Tooling | S–M |
| Low | Batch the N+1 meal-macro / shopping-list-resolution queries (A5) | Performance | M |
| Low | Optional lightweight login-attempt backoff (§2.3) | Security (accepted-risk item) | S |
| Low | Reminders/push notifications for peptide/body logging (F3) | Functionality | M–L |
| Low | Manual ingredient-paste fallback for recipe import (F4) | Functionality | M |

---

## 6. Stack & environment reference

- **Frontend/backend**: SvelteKit 2.70 (Svelte 5, runes mode) + TypeScript, single Node process via
  `@sveltejs/adapter-node`, serving both UI and API routes.
- **Data**: SQLite via Drizzle ORM + `better-sqlite3`, one file, migrations in `drizzle/` (generate
  with `npm run db:generate`, never hand-edited; `db:push` is dev-only schema sync).
- **Styling**: Tailwind CSS v4, design tokens as CSS custom properties in `src/routes/layout.css`,
  zero charting/UI-kit dependencies (progress charts are hand-rolled inline SVG).
- **Auth**: hand-rolled, `scrypt` password hashing + opaque session tokens (no external auth
  dependency, no JWT).
- **AI**: `@anthropic-ai/sdk`, server-side only, gated behind an API key + per-user daily quota +
  per-feature cooldowns; three cached one-shot "insight" features plus a streaming tool-using AI
  Coach with two external, keyless biomedical-data tools (PubMed, ClinicalTrials.gov).
- **Deployment**: Docker Compose is the primary path (`docker compose up -d --build`); a standalone
  Proxmox VE LXC installer script is also provided. Migrations run automatically on container start.
- **Local dev**: `npm install && cp .env.example .env && npm run db:push && npm run dev`. Requires
  Node 22+. `npm run check` is the only verification command; there is no `test` or `lint` script.
- **No test framework, no linter configured** (see §4.5).
