# Prompt: make the peptide tracker multi-route

Paste this to the implementing agent. Written in English to match the codebase and `CLAUDE.md`.

**Before you start: `git pull`.** The peptide suite landed in `7240aee` ("Add peptide tracking:
encrypted dose-adherence suite", merged into `main`, migration `0020`). A clone from before
2026-07-22 does not contain it.

---

## The task

The peptide tracker is **injection-only by design** and needs to become **route-aware**. Everything
non-injectable — nasal spray, topical serum, oral capsules, sublingual, transdermal — currently has
no representation: no concentration math, no container type, no measurement unit, no site model. A
user who takes Semax nasally or GHK-Cu as a serum can only log a bare mcg number with an
injection-shaped form around it, and gets no calculator at all.

This is a **widening of an existing, well-built feature**, not a rewrite. Preserve the existing
architecture, the encryption model, and the deliberate no-medical-advice scope.

---

## What exists today (read these first)

| File | Role |
|---|---|
| `src/lib/utils/peptides.ts` | Route/site/category constants, site rotation, dose formatting |
| `src/lib/utils/reconstitution.ts` | Pure syringe math |
| `src/lib/utils/peptideSchedule.ts` | Frequency, weekday mask, on/off cycle, `isDueOn`, adherence denominator |
| `src/lib/server/db/schema.ts` | `peptides`, `peptideProtocols`, `peptideVials`, `peptideDoses` |
| `src/lib/server/crypto/fieldCrypto.ts` | AES-256-GCM field encryption, HKDF-separated, AAD-bound |
| `src/lib/server/repositories/peptide*.ts` | userId-scoped CRUD + decrypt |
| `src/lib/server/peptidePresets.ts` | Starter compound catalog (names + categories only) |
| `src/lib/components/peptides/LogDoseModal.svelte` | The dose form |
| `src/routes/peptides/` | Dashboard + `/manage` |

### The eight places injection-only is hard-coded

1. **`peptides.ts`** — `type InjectionRoute = 'subq' | 'im'`. That is the entire route universe.
2. **`peptides.ts`** — `INJECTION_SITES` is 10 body sites; `suggestNextSite` does LRU rotation over
   them. Meaningless for oral, wrong shape for nostrils.
3. **`reconstitution.ts`** — U-100 syringe math only (`units = doseMcg*bacWaterMl/(vialMg*10)`).
4. **`peptideVials` enc** — `{ vialMg, bacWaterMl, reconstitutedAt, expiresAt, notes }`. Assumes
   lyophilized powder + bacteriostatic water. No pump volume, no % w/v, no capsule count.
5. **`peptides` enc** — carries `vialMg`, i.e. the compound itself presumes a vial.
6. **`peptideDoses` enc** — `{ doseMcg, site, route, time, unitsShown, notes }`. `unitsShown` is
   syringe-specific and there is no field for "2 sprays" or "4 drops".
7. **`peptideDoses.logDose`** — `isInjectionRoute` / `isInjectionSite` **silently null out** any
   value outside the injection enums. Widen these first or new data is dropped on write.
8. **`LogDoseModal.svelte`** — label hard-coded to "Injection site", `SitePicker` always rendered,
   route `<select>` has exactly two options, readout hard-coded to "units on a U-100 syringe".

Also: `peptidePresets.ts` categorises **GHK-Cu as `healing`** (it is overwhelmingly used as a
topical serum) and **PT-141 as `other`** (commonly intranasal), and omits Semax and Selank entirely —
the two canonical intranasal compounds. There is no `nootropic` or `cosmetic` category.

---

## Key architectural insight — this needs (almost) no migration

Every sensitive field lives inside an opaque AES-256-GCM `enc` blob. **Adding fields to those JSON
payloads requires no SQL migration at all.** Only a new *cleartext* column would need `0021`.

**Do not add cleartext columns.** Keep everything new inside `enc`. The change becomes pure
TypeScript, `drizzle/` stays untouched, and no data is at risk.

**Consequence — backward compatibility is now your main correctness risk.** Existing rows decrypt to
the old shape. Every `decode()` must default missing fields, and the defaults must reproduce today's
behaviour exactly:

```ts
form:         enc.form         ?? 'vial'
route:        enc.route        ?? null      // unchanged
measureUnit:  enc.measureUnit  ?? 'unit'    // U-100 units
measureCount: enc.measureCount ?? enc.unitsShown ?? null
kind:         enc.kind         ?? 'dose'
```

An existing user's history, adherence %, calendar, and vial usage counts must be **byte-identical**
before and after this change. Verify that explicitly.

---

## Design

### 1. Route taxonomy — `src/lib/utils/peptides.ts`

Introduce the wider type, keep the narrow one as a subtype:

```ts
export type AdminRoute =
  | 'subq' | 'im'                                   // injection
  | 'intranasal' | 'topical' | 'oral' | 'sublingual' | 'transdermal';

export type InjectionRoute = Extract<AdminRoute, 'subq' | 'im'>;
```

`isInjectionRoute()` keeps its current meaning (true only for `subq`/`im`) and becomes the gate that
decides whether the site picker and syringe readout appear. Add `isAdminRoute()` for validation.
`ROUTE_LABELS` extends to all seven.

### 2. Site taxonomy

Generalise `InjectionSite` → `ApplicationSite`, partitioned per route:

- injection / transdermal: the existing 10 body sites
- intranasal: `nostril_l`, `nostril_r`, `nostril_both`
- topical: `face`, `neck`, `scalp`, `hands`, `joint_l`, `joint_r`
- oral / sublingual: no site (`null`)

Make `suggestNextSite` **route-aware**: LRU rotation within that route's own site set. Nostril
alternation matters to users for the same reason injection-site rotation does — keep the existing
rotation logic, just parameterise the candidate list.

### 3. Container forms — `peptideVials` enc payload

The table name stays (renaming costs a migration for no benefit). Widen the payload:

```ts
type VialEnc = {
  form: 'vial' | 'nasal_spray' | 'serum' | 'capsules' | 'patches';   // default 'vial'
  vialMg: number;                    // existing — peptide mass in the container
  bacWaterMl: number | null;         // existing — solvent/carrier volume
  concentrationMgMl?: number | null; // entered directly for serums, else derived
  percentWv?: number | null;         // serum strength; 1% = 10 mg/mL
  actuationVolumeUl?: number | null; // nasal pump 50/100/140; dropper ≈50; serum pump
  primingActuations?: number | null; // sprays lost priming a fresh atomiser
  unitCount?: number | null;         // capsules/patches in the pack
  unitMassMcg?: number | null;       // mcg per capsule/patch
  reconstitutedAt, expiresAt, notes  // existing
};
```

Widen `sanitize()` accordingly — it currently caps `vialMg ≤ 1000` and `bacWaterMl ≤ 100`, which is
fine for nasal bottles (5–30 mL); add range checks for the new fields in the same style.

### 4. Dose enc payload

```ts
measureCount: number | null;   // 2
measureUnit: 'unit' | 'ml' | 'spray' | 'drop' | 'pump' | 'capsule' | 'patch';
kind: 'dose' | 'prime';
```

Storing **both** `doseMcg` and the `measureCount`+`measureUnit` pair is the point: `doseMcg` keeps
adherence and history comparable, the measure pair preserves what the user physically did so the UI
can render "2 sprays (L, R)" instead of "400 mcg". `unitsShown` stays for backward compatibility;
treat it as the injection special case of `measureCount`.

`kind: 'prime'` lets priming actuations deplete a bottle **without** counting toward adherence — the
single most common source of wrong nasal bottle math.

### 5. New pure math — `src/lib/utils/delivery.ts`

Same spirit as `reconstitution.ts`: pure, dependency-free, no medical judgement, comment header with
the derivation. The identity **`mg/mL × µL ≡ µg`** collapses nasal, dropper, and pump dosing into one
function — that identity is why this is tractable at all.

```ts
percentToMgMl(percent)                        // = percent * 10
mcgPerActuation(concentrationMgMl, volumeUl)  // = concentrationMgMl * volumeUl
actuationsForDose(doseMcg, mcgPerActuation)   // → { whole, remainder } so UI warns on non-integer
actuationsPerContainer(volumeMl, volumeUl, primingActuations)
actuationsRemaining(remainingMcg, mcgPerActuation)
daysOfSupply(remainingMcg, dailyMcg)
nostrilSplit(sprays)                          // → [left, right], alternating on odd counts
doseFromUnits(unitCount, unitMassMcg)         // oral/transdermal
```

**Verify against these before writing any UI** (cross-checked against published calculators):

| Case | Input | Expected |
|---|---|---|
| Injection (regression) | 250 mcg, 5 mg vial, 2 mL | 10 U, 0.10 mL |
| Nasal | 10 mg in 5 mL = 2 mg/mL, 100 µL pump | 200 mcg/spray |
| Nasal | 10 mg in 10 mL = 1 mg/mL, 100 µL pump | 100 mcg/spray |
| Bottle life | 5 mL @ 100 µL, 3 priming | 50 actuations, 47 usable |
| Topical | 3% serum = 30 mg/mL, 4 drops @ 50 µL | 6000 mcg (6 mg) |
| Oral | 500 mcg/capsule × 2 | 1000 mcg |

### 6. `LogDoseModal.svelte` — route-aware form

One component, branching on the selected route. Everything else (compound, date, time, notes,
container) stays shared.

| Route | Measurement input | Site input | Live readout |
|---|---|---|---|
| subq / im | units (existing) | `SitePicker` (existing) | "≈ 10 U on a U-100 syringe" |
| intranasal | spray count | nostril L / R / both | "2 sprays · 400 mcg · 45 left in bottle" |
| topical | drops or pumps | area picker | "4 drops · 6 mg · 3% serum" |
| oral | capsule count | — | "2 caps · 1000 mcg" |
| sublingual | drops | — | "3 drops · 900 mcg" |
| transdermal | patch on / off | placement | "patch on 08:14" |

Route should default from the selected container's `form`, so the concentration computed when the
container was created flows straight into the log. That link is the actual feature.

### 7. Presets — `peptidePresets.ts`

Add `nootropic` and `cosmetic` to `PEPTIDE_CATEGORIES`. Recategorise **GHK-Cu → cosmetic**, **PT-141
→ other (nasal-capable)**. Add **Semax**, **Selank**, **N-Acetyl Semax Amidate**, **N-Acetyl Selank
Amidate**, **Oxytocin**.

Add a `defaultForm` field to each preset (`'vial' | 'nasal_spray' | 'serum' | …`). A compound's
customary presentation is an identity fact, exactly like its category — it is **not** dosing
guidance, and the existing "names + categories only, no dose/schedule/usage guidance" policy in that
file's header comment stays in force. Do not add doses, ranges, frequencies, or protocols.

`seedPeptidesForUser` is idempotent and matches on lowercased name — new presets will backfill for
existing users on next visit. Confirm that still holds.

---

## Two rules you must not break

1. **Never sum mcg across routes, and never apply a bioavailability factor.** Intranasal, oral, and
   transdermal bioavailability differ by more than an order of magnitude and are compound-specific;
   any conversion factor would be invented pharmacokinetics rendered as fact. Group totals **by
   route**, always labelled. If the dashboard shows a combined figure today, check it.
2. **No dosing advice.** The feature does arithmetic on user-entered numbers and records what the
   user did. Presets stay names + categories + customary form. Keep the existing not-medical-advice
   disclaimer, and keep the feature gated on `PHOTO_ENCRYPTION_KEY`.

---

## Repo rules

- **No new tables and no new cleartext columns** → no migration. If you conclude one is truly
  unavoidable, stop and say so before generating it; the next file would be `drizzle/0021_*.sql` via
  `npm run db:generate` (never `db:push`), and `admin.deleteUser`'s child→parent delete order would
  need updating.
- Every repository function takes `userId` first and filters on it. There is no row-level security —
  a missing `userId` filter is a cross-account leak.
- Route code calls repositories only; never `db`/`schema` directly.
- Decryption happens only inside the userId-scoped repository layer. Do not leak `enc` to the client.
- No new dependencies. No zod (validation is inline by design), no date library, no charting library.
- Use `parseDecimal` on every numeric input — comma decimals (`0,05`) are already supported
  elsewhere and a calculator that misreads them is a real hazard.
- Svelte 5 runes, Tailwind v4, CSS-variable design tokens. Reuse `Modal`, `NumberField`,
  `NumberStepper`, `Chip`, `Card`, `Button`.
- `npm run check` (svelte-check) must pass with 0 errors — it is the only automated gate. Use the
  `fitness-tracker:verify` skill for end-to-end verification against an isolated DB copy.

---

## Suggested order

**Phase 1 — foundation + intranasal.** Route/site taxonomy, enc widening with backward-compatible
decode, `delivery.ts` (verify the table in §5 first), container form `nasal_spray`, route-aware
`LogDoseModal`, nostril rotation, priming. Ship this alone; it closes the largest gap.

**Phase 2 — topical + oral.** `% w/v` ↔ mg/mL, drops and pumps, area picker, capsule counts.
Recategorise GHK-Cu; add the nasal nootropic presets.

**Phase 3 — transdermal + inventory polish.** Patch on/off duration, remaining-actuation and
days-of-supply readouts on the dashboard, low-container alert, and — if wanted — "add to shopping
list" from a depleted container, reusing `shoppingList.ts`.

**Start with §5.** Verify all six worked examples before writing a line of schema or UI. The
regression row must still produce 10 U.
