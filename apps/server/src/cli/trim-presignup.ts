import type { ChampionUsage, MatchTotals } from '@challenge/core/domain';

import { bootstrap } from './bootstrap';
import { listPlayers } from '../db/players';
import { MAX_RECENT_RESULTS } from '../sync/helpers';
import { countFrom } from '../sync/riot';

/**
 * Drops the games a player had already played before they joined the roster, and
 * rebuilds their stored counters from what is left.
 *
 * The tournament window opened for everybody on the same date, so anyone who
 * signed up later arrived with games already banked — ten straight wins in one
 * case. The ingest now starts each player at `max(tournamentStart, createdAt)`,
 * which stops it happening again; this is the one-time cleanup for the rows that
 * landed before that rule existed.
 *
 * Reads nothing from Riot: every column the counters need is already on the
 * stored row, so the rebuild reproduces exactly what the sync would have
 * accumulated had those games never been ingested.
 *
 * Deliberately left alone:
 *
 *   - `processed_matches`, so the next cycle does not fetch the same games
 *     straight back in. The markers are the only thing keeping them out.
 *   - `blue_shells` and `coin_ledger`. Those payouts have been in circulation
 *     for days — some of the shells may already have been thrown at somebody.
 *     Clawing them back would rewrite other people's games, which is a bigger
 *     unfairness than the one being fixed.
 *
 * Dry run unless called with --apply.
 */

const apply = process.argv.includes('--apply');
const { config, db } = bootstrap();
const tournamentStart = Date.parse(config.tournament.startsAt);

interface StoredMatch {
  match_id: string;
  played_at: number;
  win: number;
  champion_id: number;
  champion_name: string;
  kills: number;
  deaths: number;
  assists: number;
  creep_score: number;
  duration_minutes: number;
}

function emptyTotals(): MatchTotals {
  return {
    games: 0,
    wins: 0,
    losses: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    minutesPlayed: 0,
    creepScore: 0,
  };
}

/** The same fold the sync applies per match, replayed over the rows we keep. */
function rebuild(kept: StoredMatch[]) {
  const totals = emptyTotals();
  const championUsage: Record<string, ChampionUsage> = {};
  let winStreak = 0;

  for (const row of kept) {
    const win = row.win === 1;

    totals.games += 1;
    totals.wins += win ? 1 : 0;
    totals.losses += win ? 0 : 1;
    totals.kills += row.kills;
    totals.deaths += row.deaths;
    totals.assists += row.assists;
    totals.minutesPlayed += row.duration_minutes;
    totals.creepScore += row.creep_score;

    const key = String(row.champion_id);
    const usage = championUsage[key] ?? {
      championId: row.champion_id,
      championName: row.champion_name,
      games: 0,
      wins: 0,
    };
    championUsage[key] = {
      ...usage,
      games: usage.games + 1,
      wins: usage.wins + (win ? 1 : 0),
    };

    // Reset on a loss, exactly like the cycle: this is the streak running now,
    // not the longest one ever.
    winStreak = win ? winStreak + 1 : 0;
  }

  // Newest first, matching how the sync prepends and trims for the form graph.
  const recentResults = kept
    .map((row) => row.win === 1)
    .reverse()
    .slice(0, MAX_RECENT_RESULTS);

  return { totals, championUsage, recentResults, winStreak };
}

const players = listPlayers(db);
let deleted = 0;
let touched = 0;

for (const player of players) {
  const cutoff = countFrom(tournamentStart, player) * 1000;

  const all = db
    .prepare(
      `SELECT match_id, played_at, win, champion_id, champion_name, kills, deaths,
              assists, creep_score, duration_minutes
       FROM player_matches WHERE player_id = ? ORDER BY played_at ASC`,
    )
    .all(player.id) as StoredMatch[];

  const doomed = all.filter((row) => row.played_at < cutoff);
  if (doomed.length === 0) continue;

  const kept = all.filter((row) => row.played_at >= cutoff);
  const before = db
    .prepare('SELECT totals FROM player_state WHERE player_id = ?')
    .get(player.id) as { totals: string } | undefined;
  const next = rebuild(kept);

  const previous = before ? (JSON.parse(before.totals) as MatchTotals) : emptyTotals();
  console.log(
    `${player.displayName}: joined ${player.createdAt}, dropping ${doomed.length} of ${all.length}`,
  );
  console.log(
    `   games ${previous.games} -> ${next.totals.games} · ` +
      `record ${previous.wins}W ${previous.losses}L -> ${next.totals.wins}W ${next.totals.losses}L`,
  );

  deleted += doomed.length;
  touched += 1;

  if (!apply) continue;

  // One transaction per player: a crash leaves whole players done or untouched,
  // never a player whose rows are gone and whose counters still include them.
  db.transaction(() => {
    for (const row of doomed) {
      db.prepare('DELETE FROM player_matches WHERE player_id = ? AND match_id = ?').run(
        player.id,
        row.match_id,
      );
    }

    db.prepare(
      `UPDATE player_state
       SET totals = ?, champion_usage = ?, recent_results = ?, win_streak = ?
       WHERE player_id = ?`,
    ).run(
      JSON.stringify(next.totals),
      JSON.stringify(next.championUsage),
      JSON.stringify(next.recentResults),
      next.winStreak,
      player.id,
    );
  })();
}

console.log('');
if (apply) {
  console.log(`[trim] ${deleted} matches removed across ${touched} players`);
  console.log('[trim] counters rebuilt from the remaining rows');
} else {
  console.log(`[trim] dry run — ${deleted} matches across ${touched} players would go`);
  console.log('[trim] re-run with --apply to commit');
}

db.close();
