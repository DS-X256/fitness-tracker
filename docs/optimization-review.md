# Optimization review — 2026-10-10

Inspected the SvelteKit app's page loaders, repository queries, database indexes,
frontend asset loading, and service worker. Applied recipe, PWA asset, workout-query, and weight-history optimizations
without schema changes.

## Recipe loading

Meal lists previously calculated each recipe separately, repeatedly fetching the
same products and sub-recipes. They now load ingredients and product macros in
batches and reuse sub-recipe totals within that calculation. Recent meal lists
and meal details use the same batching. Calculations remain fresh after edits;
there is no persistent macro cache.

A temporary migration-created SQLite database containing 120 recipes sharing one
sub-recipe, plus that sub-recipe and an empty recipe, produced these results:

| Loading the full library | Before | After |
| --- | ---: | ---: |
| SQL queries | 485 | 3 |
| Median elapsed time, 15 runs | 37.93 ms | 1.94 ms |

These are local synthetic measurements, not production latency guarantees.
`tests/meal-loading.test.ts` retains the fixture and query-count regression check,
plus checks for nested totals, empty recipes, edits, search, categories, recent
lists, meal details, and account isolation. Timing is not a CI assertion.

## PWA asset loading

The service worker now serves known assets from its versioned cache before using
the network. Live navigation still comes from the server, with the existing
offline page as its fallback. API requests, mutable meal photos, private photos,
external URLs, and writes bypass the worker's asset cache.

Fonts are cached when requested instead of being downloaded during installation.
The production build contains 134 font files totaling 1,820,908 bytes (about
1.82 MB), now excluded from installation prefetch. Fonts used after the worker
activates remain available from its cache offline; unused fonts require a
connection the first time they are selected.

`tests/service-worker.test.ts` verifies installation, cache reuse, on-demand
fonts, offline navigation, and cache exclusions.

## Dashboard and assistant data loading

Home and weekly-digest workout queries now filter the date window in SQLite,
so they avoid loading old sessions and joining their sets for a weekly summary.
The assistant requests its 12 recent sessions with a database limit. The workouts
history page continues to request the complete history.

The body page, Body Insights, and the assistant now reuse a single weight-history
read for lifetime statistics, the bounded trend chart, and weight-goal progress.
With a configured goal, this reduces weight-history reads from three to one.
Statistics retain old baseline readings, and chart smoothing still starts at
its original date boundary. Empty histories and edits preserve their behavior;
the shared data lives only within the current request.

`tests/dashboard-loading.test.ts` verifies inclusive date bounds, session order,
set and exercise counts, account isolation, recent-session limits, old weight
baselines, chart smoothing, goal projections, empty histories, edits, and query
counts.

## Further opportunity to profile as catalog data grows

Catalog name/brand search uses `%term%` matching. A normal name index cannot
accelerate arbitrary substring matching. Measure with the actual imported
catalog before choosing an FTS index and its matching behavior. This remains a
code inspection finding; its production impact has not been measured.

## Validation

- `npm run check`: zero errors; 49 warnings in existing UI components.
- `npm test`: 29 tests pass.
- `npm run build`: passes with `DATABASE_URL` set to a temporary migrated database.
- `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:e2e`: five browser tests pass.
- `npm audit --audit-level=moderate`: zero vulnerabilities.
