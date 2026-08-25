# Fitness Tracker

A self-hosted, multi-user web app for tracking meals & macros, a shopping list tied
directly into your meal library, and strength training progress. Mobile-first,
installable as a PWA, and packaged to run on a home server with one command.

- **Accounts** — each person creates their own username/password account. Meals,
  categories, exercises, and workouts are completely private to each account.
- **Meal & food library** — custom foods with full macros, your own categories, search/filter.
- **Shopping list** — one tap from any meal, quantities combine automatically, checkable,
  grouped. Private by default, with an option to share your list with another account by
  username so you can shop together.
- **Strength tracker** — log sets fast during a workout, per-exercise history/chart/PRs, estimated 1RM.
- **Body tracker** — log body weight and measurements (waist, chest, arms, …), a smoothed weight
  trend with a goal + BMI, and **progress photos**. Photos are strictly private to your account,
  encrypted at rest, and stripped of location/camera metadata (see Security notes).
- **Peptide tracker** — compounds, dose/schedule protocols (editable any time, even mid-cycle),
  inventory vials, and a dose log — everything logged is editable in place, not just deletable.
  Encrypted at rest like body data, with its own private, encrypted **progress photo** gallery per
  compound.

## Requirements

- Docker and Docker Compose (`docker compose` v2, bundled with modern Docker Desktop / Docker Engine).
- That's it — SQLite runs inside the container, no separate database to install.

## Setup

```sh
git clone <this-repo-url> fitness-tracker
cd fitness-tracker
cp .env.example .env
```

Edit `.env` and set:

- `ORIGIN` — the exact URL you'll reach the app at, **including the port**, e.g.
  `http://100.64.1.2:3000` (a Tailscale IP) or `http://homeserver.tailnet-name.ts.net:3000`.
  This is required — SvelteKit rejects form submissions whose origin doesn't match.
- `PORT` — the host port to publish (defaults to `3000`; the container always listens on `3000` internally).
- `PHOTO_ENCRYPTION_KEY` — a 32-byte key used to encrypt progress photos at rest. Generate one and
  append it to `.env` (Docker Compose reads this file for `${...}` substitution, so a missing value
  triggers a `variable is not set` warning and disables photo upload/viewing):

  ```sh
  echo "PHOTO_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env
  ```

  Everything except progress photos works without it. **Back this key up together with your database**
  — if you lose it, existing photos can't be decrypted. Keep the same key across upgrades.

Then:

```sh
docker compose up -d --build
```

Open the `ORIGIN` URL you configured above and use **Create one** to make the first
account — there's no shared password to configure, everyone (up to however many people
you expect to use this — it's been built with a household of ~5 in mind) signs up their
own account directly in the app. Add it to your phone's home screen (Safari/Chrome →
Share/Menu → "Add to Home Screen") to install it as a PWA.

Your data lives in a Docker named volume (`fitness-data`, mounted at `/data` in the
container) — it survives `docker compose down`, rebuilds, and image upgrades. To back it
up, copy `/data/fitness.db` out of the volume, e.g.:

```sh
docker compose cp fitness-tracker:/data/fitness.db ./backup-$(date +%F).db
```

To upgrade after pulling new code:

```sh
git pull
docker compose up -d --build
```

Schema migrations run automatically on container start.

> **Upgrading into the progress-photos release:** this version adds `PHOTO_ENCRYPTION_KEY`. If Compose
> warns `variable is not set`, add a key to your existing `.env` once, then rebuild:
> `echo "PHOTO_ENCRYPTION_KEY=$(openssl rand -hex 32)" >> .env && docker compose up -d --build`.

## Deploying to a Proxmox VE LXC

`proxmox/fitness-tracker.sh` is styled after the [community-scripts.org](https://community-scripts.org)
(Proxmox VE Helper-Scripts) installers — same banner, spinner, and `msg_info`/`msg_ok`
output, the same "Default vs Advanced Install" whiptail menu, and the same update
convention (re-run the script again, but *inside* the container, to update). It's a
standalone script rather than sourcing their live `build.func` framework: that framework
always fetches app installers from its own github.com/community-scripts/ProxmoxVE
catalog, and there's no supported way to point it at a different repo's install script.
Since Fitness Tracker isn't in that catalog, this vendors the same look and flow instead.

Run it **on the Proxmox host itself**, as root:

```sh
./proxmox/fitness-tracker.sh
```

or, without cloning the repo onto the host first (works once this repo is public, or
with a token embedded in the URL — see below):

```sh
bash -c "$(curl -fsSL https://raw.githubusercontent.com/DS-X256/fitness-tracker/main/proxmox/fitness-tracker.sh)"
```

Choose **Default Install** to auto-pick a free container ID, storage, and the newest
Debian 12 template, or **Advanced Install** to set the container ID, hostname, disk,
cores, RAM, bridge, static/DHCP networking, and storage yourself. It creates the LXC,
installs Docker inside it, deploys the app, and prints the URL when done.

**To update later:** run the exact same command again, but *inside* the container
(`pct enter <CTID>`) instead of on the host — it detects it's already inside the LXC and
pulls + rebuilds instead of trying to create a new container.

`REPO_URL`, `APP_DIR`, and `APP_PORT` are overridable via environment variables set
before running the script — see the comments at the top of `proxmox/fitness-tracker.sh`.
Since this repo is private, cloning it from inside the container needs credentials:
make the repo public, use an SSH deploy key already on the Proxmox host (and set
`REPO_URL` to the SSH form), or embed a token in the HTTPS `REPO_URL` for the one-time
clone.

## Sharing a shopping list

By default your shopping list is private, same as everything else. To shop together
with someone else on the same instance: open your list → **Share** → enter their
username. They'll see your list as an extra tab next to their own ("Mine" / "their
username's list") and can add, check off, and remove items on it. You can revoke access
any time from the same Share panel; they can also leave a shared list themselves.

## Security notes

This app assumes you're reaching it over your own network (Tailscale, LAN, or a VPN) —
**do not expose it directly to the public internet.** Account signup is open to anyone
who can reach the app (no invite codes, no email verification, no rate limiting) — that's
appropriate for a small trusted group on a private network, not for anything internet-facing.

**Progress photos** are treated as the most sensitive data in the app and get extra protection
regardless of the private-network assumption:

- **Encrypted at rest** with AES-256-GCM. Set `PHOTO_ENCRYPTION_KEY` in `.env` to a 32-byte key
  (`openssl rand -base64 32`); the on-disk files are ciphertext, decrypted only when served to the
  owner. If the key is unset, photo upload/viewing is disabled and the rest of the app is unaffected.
  **Back the key up alongside your database** — losing it makes existing photos unrecoverable.
- **Metadata stripped** — EXIF/XMP/IPTC (including phone GPS coordinates) is removed before storage.
- **Strictly private** — unlike meals and the shopping list, progress photos can never be shared;
  every request is checked against the owner and served with `no-store`, so they don't linger in caches.

## Local development (without Docker)

Requires Node.js 22+.

```sh
npm install
cp .env.example .env   # DATABASE_URL=local.db is already dev-appropriate
npm run db:push        # create/update the local SQLite schema from the current schema.ts
npm run dev
```

`npm run db:push` is for local development only (it's interactive/best-effort schema
sync). Production uses versioned SQL migrations in `drizzle/`, generated with
`npm run db:generate` after changing `src/lib/server/db/schema.ts` and applied
automatically by the container on startup (`scripts/migrate.js`).

## Tech stack

SvelteKit (Svelte 5, TypeScript) with `adapter-node`, one process serving both the UI
and the API. SQLite via Drizzle ORM + better-sqlite3 — a single file, no database
container. Passwords are hashed with Node's built-in `scrypt` (no auth dependency).
Tailwind CSS v4 for styling, design tokens defined as CSS variables in
`src/routes/layout.css`. Zero UI/charting dependencies beyond that — the progress chart
is hand-rolled inline SVG.
