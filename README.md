# Confia Hermano Challenge

Leaderboard for a private League of Legends SoloQ challenge. Renders standings,
a podium, per-role filters and aggregate statistics, and refreshes itself on a
fixed interval.

Built with Astro (static output), one React island for the interactive parts,
and a separate Node worker that talks to the Riot API.

## How it works

```
scripts/refresh.ts  ──►  Riot API  ──►  data/state.json
        │                                     │
        └──────────────────────────►  public/data/snapshot.json
                                              │
                              Astro renders it at build time
                                              │
                              React island re-fetches every cycle
```

Two rules drive this shape:

1. **The browser never talks to Riot.** The API key stays on the machine running
   the worker. A key shipped to the client is a leaked key.
2. **The worker is the only consumer of the API.** It owns the rate limiter, so
   traffic to Riot is a function of the refresh interval and the roster size —
   not of how many people have the page open.

`data/state.json` accumulates per-player totals and the set of matches already
counted, so each cycle only downloads matches it has never seen.

## Getting started

```bash
pnpm install
pnpm refresh      # writes public/data/snapshot.json using simulated data
pnpm dev
```

The site works immediately with mock data — no Riot key required. Use this to
build and review the UI without spending rate limit.

## Going live with real data

1. Get a key at [developer.riotgames.com](https://developer.riotgames.com).
   Development keys expire every 24 hours. For a private challenge, register the
   product and request a **Personal key**, which does not expire.
2. `cp env.example .env` and fill in `RIOT_API_KEY`, then set `DATA_SOURCE=riot`.
3. Edit `tournament.config.json` with the real roster and dates.
4. `pnpm refresh` once to verify, then `pnpm refresh:watch` to keep it running.

### tournament.config.json

| Field                    | Meaning                                                    |
| ------------------------ | ---------------------------------------------------------- |
| `platform`               | Riot platform id (`euw1`, `na1`, `la2`, …), not the region |
| `queue`                  | `RANKED_SOLO_5x5` or `RANKED_FLEX_SR`                      |
| `startsAt` / `endsAt`    | ISO timestamps; drive LP-gained and the end countdown      |
| `refreshIntervalMinutes` | Worker cadence and the countdown the page displays         |
| `players[].role`         | One of `TOP`, `JUNGLE`, `MID`, `ADC`, `SUPPORT`            |
| `players[].mock`         | Optional fixture for mock mode; ignored when using Riot    |

A `mock` block pins a player to fixed values so the simulated board keeps a
known shape. `ladderPoints` is absolute: `2800` is Master 0 LP, `0` is Iron IV.

```json
"mock": { "wins": 100, "losses": 0, "ladderPoints": 4108, "startLadderPoints": 2800 }
```

The config is validated on startup — a bad role or a malformed date fails loudly
instead of producing a half-broken leaderboard.

## Rate limit budget

Per cycle, per player: 1 ACCOUNT-V1 + 1 SUMMONER-V4 + 1 LEAGUE-V4 +
1 SPECTATOR-V5 + 1 MATCH-V5 list, plus one MATCH-V5 detail per *new* match.
That is ~5 calls per player in a quiet cycle.

With a 100-requests-per-2-minutes budget, a 2-minute cycle supports roughly
**15 players** before the limiter starts pacing calls into the next window.
Raise `refreshIntervalMinutes` as the roster grows — the limiter will never
exceed the budget, it will just take longer to finish a cycle.

Both limit windows are enforced in `src/lib/riot/rate-limiter.ts`, and a 429
response applies a penalty derived from Riot's `Retry-After` header.

## Deployment

`pnpm build` produces a static `dist/`. Host it anywhere.

The worker runs separately and must be able to write into the same
`public/data/snapshot.json` the site serves. Two workable setups:

- **Single box**: serve `dist/` with any static server and run
  `pnpm refresh:watch` alongside it, writing into `dist/data/snapshot.json`.
- **Static host**: run the worker on a small VPS or a cron job that pushes the
  updated `snapshot.json` to object storage the site reads from.

## Project layout

```
src/lib/domain/     Pure logic: ladder points, win rate, KDA. No I/O.
src/lib/riot/       Riot API client, dual routing, rate limiter.
src/lib/providers/  Mock and Riot data sources; accumulated worker state.
src/components/     React island and its presentational pieces.
src/pages/          Astro page; reads the snapshot at build time.
scripts/refresh.ts  The worker entry point.
```

`domain` knows nothing about Riot or React, which is why the mock provider and
the real one are interchangeable without touching a single component.

## Notes on the design

Single dark mode, deliberately. Three colour layers, each with a different job:

- **Monochrome** — pure white is the loudest thing on the page. Rank numbers,
  LP and the category winners are white; everything else is grey.
- **Accent** (`--color-accent`, cyan) — interaction and liveness only: active
  tab, focus ring, live dot, progress rail. It never encodes data.
- **Information** — every player is tinted by their real League tier, so a row's
  colour means something instead of decorating it.

The five data-mark colours (`--color-mark-*`) were validated for lightness band,
chroma floor, contrast against the `#0e1116` surface, and colour-vision
separation. Changing one means re-validating the whole set.

Nothing depends on colour alone: win/loss carries counts and a percentage,
movement carries an arrow plus a number, the live indicator carries a label, and
every rank carries its tier name.

Type: Chakra Petch for display and UI labels, Inter for body, JetBrains Mono for
every number so columns align.

`.display`, `.eyebrow`, `.tabular` and `.neon` live inside `@layer components`
so Tailwind utilities can still override them — without that, a `text-[0.62rem]`
silently loses to the class's own `font-size`.

## Icons

Role glyphs and ranked crests come from
[Community Dragon](https://raw.communitydragon.org), and are **served from this
site**, not hot-linked, so the page has no runtime dependency on anyone else's
uptime.

- Ranked crests: `public/icons/tiers/*.svg`, pulled from
  `rcp-fe-lol-static-assets/.../ranked-mini-crests/`. Emerald is only published
  as SVG there, which is why the whole set is SVG.
- Role glyphs: redrawn inline in `src/components/icons.tsx` so they inherit
  `currentColor` instead of Riot's client gold.

To refresh them after a season art change, re-download the crests and bump
`DDRAGON_VERSION` in `src/components/ui.tsx` for champion and profile art.


## Legal

Not endorsed by Riot Games. Follow the
[Riot API policies](https://developer.riotgames.com/policies/general) — no
betting, no live competitive-advantage data, keep the disclaimer in the footer.
