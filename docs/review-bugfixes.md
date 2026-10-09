# Review bugfixes — 9 October 2026

This implements the confirmed findings F01–F14 from the review of `f562252`, using the
existing repository, delivery, scheduling and design-token patterns. The Semax/Selank
presets merged separately in PR #42. Broader product recommendations (protocol revisions,
exports, search, reminders, AI spending accounting and performance work) remain roadmap work.

| Finding | Result |
| --- | --- |
| F01 | WAL-aware SQLite backup plus uploads, explicit stopped-writer requirement, restore/key instructions and an automated restore/decryption test. Container includes backup tooling. |
| F02 | Quick-log accepts exact whole actuations/capsules/patches; otherwise rejects without a row and opens the existing Adjust form. Fractional target vs actual quantity is never silently rounded. |
| F03 | Pending slots are supplied separately for each protocol sharing stock; mixed doses and multi-slot schedules have regression tests. |
| F04 | All photo upload types decode with a pixel limit, apply orientation and re-encode without metadata; malformed images fail closed. |
| F05 | Meal-photo responses use `private, no-store`; browser replacement and authorization checks are covered. Existing UI already versions image URLs. |
| F06 | Account deletion includes peptide photos and writes a durable cleanup manifest before deleting rows. Failed unlink operations log and retry on startup/subsequent deletion. An active account's queued files are never removed. |
| F07 | Photo create/update checks compound ownership before writing the link; null remains valid for general photos. |
| F08 | Shared workout writes validate calendar dates, positive integer repetitions, finite nonnegative kg and optional finite RPE 1–10. Zero kg supports bodyweight. Invalid submissions return actionable errors. |
| F09 | An immediate SQLite transaction grants admin to the first created account; concurrent signup creates exactly one initial admin. Last-admin protection remains. |
| F10 | Shared native modal dialogs provide semantics, inert background, initial focus, contained keyboard navigation, Escape and focus restoration. Existing appearance and motion settings remain. |
| F11 | Browser zoom is allowed; shared light-theme foregrounds meet contrast checks, with visible keyboard focus. Tests sample four pages and the compound modal across all 11 explicit themes. |
| F12 | Authenticated navigation uses the current user, so signup/login show the public shell. |
| F13 | Vitest regression tests, production Playwright checks and GitHub Actions now cover check/test/audit/build/browser. Required-check enforcement remains a GitHub repository setting. |
| F14 | Compatible overrides patch bundled devalue/cookie and development source-map-js/esbuild; npm audit reports zero vulnerabilities for the resolved lockfile. No framework major upgrade or forced downgrade. |

The additional source-confirmed future-date discrepancy in AI peptide facts is also fixed:
blend totals, protocol history and side-effect check-ins now use the same upper date bound as
intake. The facts version changes so cached recaps regenerate.

## Verification

- 16 unit/integration tests passed, using real SQL migrations and temporary synthetic data.
- Five production HTTP/browser tests passed in Chromium.
- Type checking: zero errors; 49 pre-existing Svelte warnings remain.
- Production build passed; npm audit reports zero vulnerabilities.
- Docker image build passed with this cloud environment's CA mounted into npm installation
  steps through an external temporary Dockerfile. TLS verification stayed enabled.
- Fresh container login, unauthenticated redirect, SQLite integrity and packaged backup smoke
  checks passed. No production instance or actual user records were modified.

## Existing data and release notes

Take a complete backup before deployment and follow the restore procedure in README.
New validation prevents further invalid rows; historical workout values are not silently
rewritten. Review any invalid historical values in the normal edit flow. Existing uploaded
photos are not bulk-transformed; re-upload legacy meal photos that may contain location
metadata. Already downloaded/cached images cannot be remotely erased. Keep cleanup manifests
until retries succeed, and investigate repeated filesystem errors in server logs.

Photos are treated as still images: animated uploads use the first frame. Image processing
adds the native `sharp` runtime dependency, verified in both Node and Docker builds. Original
photo bytes are not retained by new uploads. Private-photo encryption and ownership gates
remain in place. Body measurements and photo captions are still plaintext fields; peptide
records and private photo bytes use the original configured encryption key.
