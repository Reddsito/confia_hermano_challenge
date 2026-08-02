# Confia Hermano Challenge

Leaderboard for a private League of Legends SoloQ challenge. Standings, podium,
per-role filters, aggregate statistics, and a roster panel the group edits with
one shared code.

## Layout

```
packages/core     Domain logic (ladder points, win rate, KDA) + Riot client.
apps/web          Astro static site, one React island. Deploys to Cloudflare Pages.
apps/server       Hono + SQLite. Polls Riot, serves the API. Runs in Docker on a VPS.
deploy/Caddyfile  TLS terminator to put in front of the API.
```

`packages/core` knows nothing about React, Hono or SQLite, which is why the same
ranking maths runs in the browser and on the server without duplication.

## How the pieces talk

```
apps/server ──poll──► Riot API
     │
     └── SQLite ──► GET /api/snapshot ──► apps/web (build + client polling)
                 ◄── /api/admin/*      ◄── /panel (shared code)
```

Two rules drive this shape:

1. **The browser never talks to Riot.** The API key lives only on the server. A
   key shipped to the client is a leaked key.
2. **The server is the only consumer of the Riot API.** It owns the rate
   limiter, so traffic to Riot depends on the refresh interval and roster size,
   never on how many people have the page open.

Match ingestion is idempotent at the database level: `processed_matches` has a
`(player_id, match_id)` primary key, and the counters and that marker are
written in one transaction. A crash mid-cycle can never double-count.

---

## Running it locally

```bash
pnpm install
```

### 1. Backend

```bash
cd apps/server
cp env.example .env          # then edit it, see below
pnpm seed                    # imports the roster from tournament.config.json
pnpm dev                     # http://localhost:8787
```

Minimum to set in `apps/server/.env`:

```ini
DATA_SOURCE=mock             # "mock" needs no Riot key at all
PLATFORM=euw1                # euw1 / na1 / la1 / la2 / kr ...
ADMIN_TOKEN=devtoken         # the code /panel asks for
ALLOWED_ORIGINS=*            # local dev only
```

### 2. Frontend

In a second terminal, from the repo root:

```bash
pnpm dev                     # http://localhost:4321
```

It defaults to `http://localhost:8787`, so no configuration is needed locally.
The roster panel is at `/panel`.

### Switching to real Riot data

```bash
cd apps/server
# in .env: DATA_SOURCE=riot, RIOT_API_KEY=RGAPI-..., real PLATFORM
pnpm doctor                  # validates the key and every Riot ID first
pnpm sync                    # one cycle, then check the site
```

`pnpm doctor` makes a single probe request and prints the live
`X-App-Rate-Limit` headers plus a per-player resolution report. Run it before
`pnpm sync` — a typo in a tag shows up there instead of as an empty row days
later.

---

## Deploying the backend

The frontend is on Cloudflare Pages and the backend on your own machine, so
every browser call is cross-origin and **the API must be served over HTTPS**.
A browser on an HTTPS page refuses to call `http://`.

### 1. On the VPS

```bash
git clone <your-repo> && cd soloq-challenge
cp apps/server/env.example apps/server/.env
```

Production `.env`:

```ini
DATA_SOURCE=riot
RIOT_API_KEY=RGAPI-...
PLATFORM=euw1
ADMIN_TOKEN=<openssl rand -hex 32>
ALLOWED_ORIGINS=https://your-site.pages.dev
REFRESH_INTERVAL_MINUTES=2
```

```bash
docker compose up -d --build
docker compose logs -f api
docker compose exec api pnpm seed     # first run only
```

The compose file publishes to `127.0.0.1:8787`, not `0.0.0.0` — the container is
only reachable through the TLS terminator.

### 2. TLS

Point an A record at the VPS, edit the domain in `deploy/Caddyfile`, then run
Caddy. It obtains and renews the certificate itself.

### 3. Frontend

On Cloudflare Pages:

- Build command: `pnpm install && pnpm build`
- Output directory: `apps/web/dist`
- Environment variable: `PUBLIC_API_URL=https://api.your-domain.com`

Then put that Pages URL into the backend's `ALLOWED_ORIGINS` and restart it.

### Operational notes

- **The volume is not optional.** The SQLite file lives on a named volume; if it
  lived in the image, every redeploy would wipe the accumulated totals and the
  challenge would restart from zero.
- **`.dockerignore` keeps `.env`, `data/` and the frontend out of the image.**
  Without it the Riot key and admin token get baked into anything you publish.
- Back up by copying the volume, or
  `docker compose exec api node -e "..."` against the database file.

---

## Rate limit budget

Per cycle, per player: 1 SUMMONER-V4 + 1 LEAGUE-V4 + 1 MATCH-V5 list +
1 SPECTATOR-V5, plus one MATCH-V5 detail per *new* match. ACCOUNT-V1 runs only
once per player, since the PUUID is cached on the row.

That is ~4 calls per player in a quiet cycle. With a 100-per-2-minutes budget, a
2-minute cycle comfortably supports ~15 players. Raise
`REFRESH_INTERVAL_MINUTES` as the roster grows — the limiter never exceeds the
budget, cycles just take longer.

Both windows are enforced in `packages/core/src/riot/rate-limiter.ts`, and a 429
applies a penalty derived from Riot's `Retry-After` header.

---

## The roster panel

`/panel` asks for one shared code (the backend's `ADMIN_TOKEN`), stored in
localStorage. Anyone with the code can add, rename, hide or delete players, and
force a refresh. It is a group password, not a user account system.

Adding a player verifies the Riot ID against ACCOUNT-V1, so typos are rejected
immediately. **Changing a player's Riot ID clears their accumulated stats** —
the row now points at a different account, and keeping the totals would credit
one person's climb to another. The panel warns before saving.

---

## Design notes

Single dark mode, deliberately. Three colour layers:

- **Monochrome** — pure white is the loudest thing on the page.
- **Accent** (`--color-accent`, cyan) — interaction and liveness only. Never
  encodes data.
- **Information** — every player is tinted by their real League tier.

The five `--color-mark-*` colours were validated for lightness band, chroma
floor, contrast against the `#0e1116` surface, and colour-vision separation.
Changing one means re-validating the set.

Nothing depends on colour alone: win/loss carries counts and a percentage,
movement carries an arrow and a number, the live indicator carries a label.

Role glyphs and ranked crests come from Community Dragon and are served from
this site, not hot-linked. Crests live in `apps/web/public/icons/tiers/`; role
glyphs are inlined in `src/components/icons.tsx` so they inherit `currentColor`.

`.display`, `.eyebrow`, `.tabular` and `.neon` live in `@layer components` so
Tailwind utilities can override them.

---

## Legal

Not endorsed by Riot Games. Follow the
[Riot API policies](https://developer.riotgames.com/policies/general) — no
betting, no live competitive-advantage data, keep the disclaimer in the footer.
