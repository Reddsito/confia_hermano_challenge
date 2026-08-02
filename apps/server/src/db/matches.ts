import type { Rank } from '@challenge/core/domain';
import { toLadderPoints } from '@challenge/core/domain';

import type { Db } from './index';

export interface PlayerMatchRow {
  playerId: string;
  matchId: string;
  playedAt: number;
  durationMinutes: number;
  teamId: number;
  win: boolean;
  championId: number;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  goldEarned: number;
  damageToChampions: number;
  damageTaken: number;
  visionScore: number;
  timeDeadSeconds: number;
  pentaKills: number;
  quadraKills: number;
  tripleKills: number;
  largestSpree: number;
  soloKills: number;
  firstBlood: boolean;
  surrendered: boolean;
  killParticipation: number | null;
  usedSmite: boolean;
  queueId: number;
}

export function insertPlayerMatch(
  db: Db,
  row: PlayerMatchRow,
  replace = false,
): void {
  db.prepare(
    `INSERT OR ${replace ? 'REPLACE' : 'IGNORE'} INTO player_matches (
       player_id, match_id, played_at, duration_minutes, team_id, win,
       champion_id, champion_name, kills, deaths, assists, creep_score,
       gold_earned, damage_to_champions, damage_taken, vision_score,
       time_dead_seconds, penta_kills, quadra_kills, triple_kills,
       largest_spree, solo_kills, first_blood, surrendered, kill_participation,
       used_smite, queue_id
     ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
  ).run(
    row.playerId,
    row.matchId,
    row.playedAt,
    row.durationMinutes,
    row.teamId,
    row.win ? 1 : 0,
    row.championId,
    row.championName,
    row.kills,
    row.deaths,
    row.assists,
    row.creepScore,
    row.goldEarned,
    row.damageToChampions,
    row.damageTaken,
    row.visionScore,
    row.timeDeadSeconds,
    row.pentaKills,
    row.quadraKills,
    row.tripleKills,
    row.largestSpree,
    row.soloKills,
    row.firstBlood ? 1 : 0,
    row.surrendered ? 1 : 0,
    row.killParticipation,
    row.usedSmite ? 1 : 0,
    row.queueId,
  );
}

/**
 * Records a rank sample, but only when it actually moved. Writing every cycle
 * would add 720 identical rows a day per player and make the chart unreadable.
 */
export function recordRankSample(
  db: Db,
  playerId: string,
  rank: Rank | null,
): void {
  if (!rank) return;

  const points = toLadderPoints(rank);
  const last = db
    .prepare(
      'SELECT ladder_points FROM lp_history WHERE player_id = ? ORDER BY recorded_at DESC LIMIT 1',
    )
    .get(playerId) as { ladder_points: number } | undefined;

  if (last && last.ladder_points === points) return;

  db.prepare(
    `INSERT OR REPLACE INTO lp_history
       (player_id, recorded_at, ladder_points, tier, division, league_points)
     VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(
    playerId,
    Date.now(),
    points,
    rank.tier,
    rank.division,
    rank.leaguePoints,
  );
}

export interface ExtraTotals {
  timeDeadSeconds: number;
  goldEarned: number;
  damageToChampions: number;
  damageTaken: number;
  visionScore: number;
  pentaKills: number;
  quadraKills: number;
  tripleKills: number;
  largestSpree: number;
  soloKills: number;
  firstBloods: number;
  surrenders: number;
  killParticipation: number | null;
  bestKdaGame: number | null;
  /** 0-23, the hour this player starts games most often. */
  favouriteHour: number | null;
}

export function extraTotalsFor(db: Db, playerId: string): ExtraTotals {
  const row = db
    .prepare(
      `SELECT
         COALESCE(SUM(time_dead_seconds), 0)   AS timeDead,
         COALESCE(SUM(gold_earned), 0)         AS gold,
         COALESCE(SUM(damage_to_champions), 0) AS damage,
         COALESCE(SUM(damage_taken), 0)        AS taken,
         COALESCE(SUM(vision_score), 0)        AS vision,
         COALESCE(SUM(penta_kills), 0)         AS pentas,
         COALESCE(SUM(quadra_kills), 0)        AS quadras,
         COALESCE(SUM(triple_kills), 0)        AS triples,
         COALESCE(MAX(largest_spree), 0)       AS spree,
         COALESCE(SUM(solo_kills), 0)          AS solos,
         COALESCE(SUM(first_blood), 0)         AS firstBloods,
         COALESCE(SUM(surrendered), 0)         AS surrenders,
         AVG(kill_participation)               AS killParticipation,
         MAX((kills + assists) * 1.0 / MAX(deaths, 1)) AS bestKda
       FROM player_matches WHERE player_id = ?`,
    )
    .get(playerId) as Record<string, number | null>;

  // SQLite has no timezone support, so the hour is derived in UTC and shifted
  // by the caller if it ever needs to be local.
  const hour = db
    .prepare(
      `SELECT CAST(strftime('%H', played_at / 1000, 'unixepoch') AS INTEGER) AS hour,
              COUNT(*) AS games
       FROM player_matches WHERE player_id = ?
       GROUP BY hour ORDER BY games DESC LIMIT 1`,
    )
    .get(playerId) as { hour: number; games: number } | undefined;

  return {
    timeDeadSeconds: row.timeDead ?? 0,
    goldEarned: row.gold ?? 0,
    damageToChampions: row.damage ?? 0,
    damageTaken: row.taken ?? 0,
    visionScore: row.vision ?? 0,
    pentaKills: row.pentas ?? 0,
    quadraKills: row.quadras ?? 0,
    tripleKills: row.triples ?? 0,
    largestSpree: row.spree ?? 0,
    soloKills: row.solos ?? 0,
    firstBloods: row.firstBloods ?? 0,
    surrenders: row.surrenders ?? 0,
    killParticipation: row.killParticipation ?? null,
    bestKdaGame: row.bestKda ?? null,
    favouriteHour: hour?.hour ?? null,
  };
}

export interface HeadToHead {
  playerA: string;
  playerB: string;
  /** Games where they were on opposing teams. */
  against: number;
  aWonAgainst: number;
  /** Games where they queued on the same team. */
  together: number;
  togetherWins: number;
}

/**
 * Two tracked players in the same match. Only possible because every game is
 * stored per player: a self-join on match_id finds the overlaps, and team_id
 * says whether they were allies or enemies.
 */
export function headToHead(db: Db): HeadToHead[] {
  const rows = db
    .prepare(
      `SELECT
         a.player_id AS playerA,
         b.player_id AS playerB,
         SUM(CASE WHEN a.team_id <> b.team_id THEN 1 ELSE 0 END) AS against,
         SUM(CASE WHEN a.team_id <> b.team_id AND a.win = 1 THEN 1 ELSE 0 END) AS aWonAgainst,
         SUM(CASE WHEN a.team_id = b.team_id THEN 1 ELSE 0 END) AS together,
         SUM(CASE WHEN a.team_id = b.team_id AND a.win = 1 THEN 1 ELSE 0 END) AS togetherWins
       FROM player_matches a
       JOIN player_matches b
         ON a.match_id = b.match_id
        -- Each pair once, not twice mirrored.
        AND a.player_id < b.player_id
       GROUP BY a.player_id, b.player_id
       HAVING against + together > 0`,
    )
    .all() as HeadToHead[];

  return rows;
}

export interface Duo {
  playerA: string;
  playerB: string;
  games: number;
  wins: number;
}

/**
 * Pairs who queued together, best win rate first.
 *
 * Same self-join as head-to-head, restricted to matching team ids. A minimum
 * game count keeps one lucky game from topping the board.
 */
export function bestDuos(db: Db, minimumGames = 2): Duo[] {
  return db
    .prepare(
      `SELECT a.player_id AS playerA,
              b.player_id AS playerB,
              COUNT(*) AS games,
              SUM(CASE WHEN a.win = 1 THEN 1 ELSE 0 END) AS wins
       FROM player_matches a
       JOIN player_matches b
         ON a.match_id = b.match_id
        AND a.player_id < b.player_id
        AND a.team_id = b.team_id
       GROUP BY a.player_id, b.player_id
       HAVING games >= ?
       ORDER BY (wins * 1.0 / games) DESC, games DESC`,
    )
    .all(minimumGames) as Duo[];
}

export interface DayDelta {
  playerId: string;
  day: string;
  delta: number;
}

/**
 * LP gained or lost per calendar day, from the first to the last sample of that
 * day. Used for the "biggest climb" and "worst tilt" boards.
 */
export function dailyDeltas(db: Db): DayDelta[] {
  return db
    .prepare(
      `WITH samples AS (
         SELECT player_id,
                date(recorded_at / 1000, 'unixepoch') AS day,
                ladder_points,
                ROW_NUMBER() OVER (
                  PARTITION BY player_id, date(recorded_at / 1000, 'unixepoch')
                  ORDER BY recorded_at ASC
                ) AS first_rank,
                ROW_NUMBER() OVER (
                  PARTITION BY player_id, date(recorded_at / 1000, 'unixepoch')
                  ORDER BY recorded_at DESC
                ) AS last_rank
         FROM lp_history
       )
       SELECT f.player_id AS playerId,
              f.day       AS day,
              l.ladder_points - f.ladder_points AS delta
       FROM samples f
       JOIN samples l ON f.player_id = l.player_id AND f.day = l.day
       WHERE f.first_rank = 1 AND l.last_rank = 1 AND l.ladder_points <> f.ladder_points
       ORDER BY delta DESC`,
    )
    .all() as DayDelta[];
}

export interface LpPoint {
  playerId: string;
  at: number;
  ladderPoints: number;
}

export function lpSeries(db: Db): LpPoint[] {
  return db
    .prepare(
      `SELECT player_id AS playerId, recorded_at AS at, ladder_points AS ladderPoints
       FROM lp_history ORDER BY recorded_at ASC`,
    )
    .all() as LpPoint[];
}

export interface StoredActiveGame {
  gameId: number;
  queueId: number;
  gameLength: number;
  participants: Array<{
    puuid: string;
    championId: number;
    teamId: number;
    riotId: string | null;
  }>;
}

export function setActiveGame(
  db: Db,
  playerId: string,
  game: StoredActiveGame | null,
): void {
  db.prepare('UPDATE player_state SET active_game = ? WHERE player_id = ?').run(
    game ? JSON.stringify(game) : null,
    playerId,
  );
}

/** Every live game currently on record, one entry per game, not per player. */
export function activeGames(db: Db): Array<{
  playerIds: string[];
  game: StoredActiveGame;
}> {
  const rows = db
    .prepare(
      'SELECT player_id AS playerId, active_game AS game FROM player_state WHERE active_game IS NOT NULL',
    )
    .all() as Array<{ playerId: string; game: string }>;

  // Two tracked players can share a lobby, so games are keyed by id and the
  // player list is merged rather than the game being listed twice.
  const byGame = new Map<number, { playerIds: string[]; game: StoredActiveGame }>();

  for (const row of rows) {
    try {
      const game = JSON.parse(row.game) as StoredActiveGame;
      const existing = byGame.get(game.gameId);
      if (existing) existing.playerIds.push(row.playerId);
      else byGame.set(game.gameId, { playerIds: [row.playerId], game });
    } catch {
      // A malformed row is dropped rather than breaking the whole endpoint.
    }
  }

  return [...byGame.values()];
}
