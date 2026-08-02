import { randomUUID } from 'node:crypto';

import type {
  ChampionUsage,
  MatchTotals,
  Rank,
  Role,
} from '@challenge/core/domain';

import type { Db } from './index';

export type PlayerStatus = 'pending' | 'approved' | 'rejected';

export interface PlayerRow {
  id: string;
  displayName: string;
  gameName: string;
  tagLine: string;
  role: Role;
  status: PlayerStatus;
  puuid: string | null;
  createdAt: string;
}

export interface PlayerStateRow {
  playerId: string;
  puuid: string;
  totals: MatchTotals;
  championUsage: Record<string, ChampionUsage>;
  recentResults: boolean[];
  startRank: Rank | null;
  currentRank: Rank | null;
  profileIconId: number | null;
  summonerLevel: number | null;
  inGame: boolean;
  lastPosition: number | null;
  lastError: string | null;
  updatedAt: string | null;
}

export function emptyTotals(): MatchTotals {
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

interface RawPlayer {
  id: string;
  display_name: string;
  game_name: string;
  tag_line: string;
  role: string;
  status: string;
  puuid: string | null;
  created_at: string;
}

function toPlayer(row: RawPlayer): PlayerRow {
  return {
    id: row.id,
    displayName: row.display_name,
    gameName: row.game_name,
    tagLine: row.tag_line,
    role: row.role as Role,
    status: row.status as PlayerStatus,
    puuid: row.puuid,
    createdAt: row.created_at,
  };
}

export function listPlayers(db: Db, status?: PlayerStatus): PlayerRow[] {
  const rows = status
    ? (db
        .prepare(
          'SELECT * FROM players WHERE status = ? ORDER BY created_at ASC',
        )
        .all(status) as RawPlayer[])
    : (db
        .prepare('SELECT * FROM players ORDER BY created_at ASC')
        .all() as RawPlayer[]);
  return rows.map(toPlayer);
}

export function findPlayerByRiotId(
  db: Db,
  gameName: string,
  tagLine: string,
): PlayerRow | null {
  const row = db
    .prepare(
      // Riot IDs are case-insensitive for lookup purposes.
      'SELECT * FROM players WHERE lower(game_name) = lower(?) AND lower(tag_line) = lower(?)',
    )
    .get(gameName, tagLine) as RawPlayer | undefined;
  return row ? toPlayer(row) : null;
}

export interface NewPlayer {
  displayName: string;
  gameName: string;
  tagLine: string;
  role: Role;
  status: PlayerStatus;
  puuid?: string | null;
}

export function insertPlayer(db: Db, player: NewPlayer): PlayerRow {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO players (id, display_name, game_name, tag_line, role, status, puuid, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    player.displayName,
    player.gameName,
    player.tagLine,
    player.role,
    player.status,
    player.puuid ?? null,
    new Date().toISOString(),
  );

  return {
    id,
    ...player,
    puuid: player.puuid ?? null,
    createdAt: new Date().toISOString(),
  };
}

export function setPlayerStatus(
  db: Db,
  id: string,
  status: PlayerStatus,
): boolean {
  return (
    db.prepare('UPDATE players SET status = ? WHERE id = ?').run(status, id)
      .changes > 0
  );
}

export function deletePlayer(db: Db, id: string): boolean {
  return db.prepare('DELETE FROM players WHERE id = ?').run(id).changes > 0;
}

export function setPlayerPuuid(db: Db, id: string, puuid: string): void {
  db.prepare('UPDATE players SET puuid = ? WHERE id = ?').run(puuid, id);
}

interface RawState {
  player_id: string;
  puuid: string;
  totals: string;
  champion_usage: string;
  recent_results: string;
  start_rank: string | null;
  current_rank: string | null;
  profile_icon_id: number | null;
  summoner_level: number | null;
  in_game: number;
  last_position: number | null;
  last_error: string | null;
  updated_at: string | null;
}

function toState(row: RawState): PlayerStateRow {
  return {
    playerId: row.player_id,
    puuid: row.puuid,
    totals: JSON.parse(row.totals) as MatchTotals,
    championUsage: JSON.parse(row.champion_usage) as Record<
      string,
      ChampionUsage
    >,
    recentResults: JSON.parse(row.recent_results) as boolean[],
    startRank: row.start_rank ? (JSON.parse(row.start_rank) as Rank) : null,
    currentRank: row.current_rank
      ? (JSON.parse(row.current_rank) as Rank)
      : null,
    profileIconId: row.profile_icon_id,
    summonerLevel: row.summoner_level,
    inGame: row.in_game === 1,
    lastPosition: row.last_position,
    lastError: row.last_error,
    updatedAt: row.updated_at,
  };
}

export function getPlayerState(db: Db, playerId: string): PlayerStateRow | null {
  const row = db
    .prepare('SELECT * FROM player_state WHERE player_id = ?')
    .get(playerId) as RawState | undefined;
  return row ? toState(row) : null;
}

export function listPlayerStates(db: Db): Map<string, PlayerStateRow> {
  const rows = db.prepare('SELECT * FROM player_state').all() as RawState[];
  return new Map(rows.map((row) => [row.player_id, toState(row)]));
}

export function upsertPlayerState(db: Db, state: PlayerStateRow): void {
  db.prepare(
    `INSERT INTO player_state (
       player_id, puuid, totals, champion_usage, recent_results, start_rank,
       current_rank, profile_icon_id, summoner_level, in_game, last_position,
       last_error, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT (player_id) DO UPDATE SET
       puuid           = excluded.puuid,
       totals          = excluded.totals,
       champion_usage  = excluded.champion_usage,
       recent_results  = excluded.recent_results,
       -- start_rank is captured once and never overwritten, so "LP gained"
       -- keeps measuring from the real starting point.
       start_rank      = COALESCE(player_state.start_rank, excluded.start_rank),
       current_rank    = excluded.current_rank,
       profile_icon_id = excluded.profile_icon_id,
       summoner_level  = excluded.summoner_level,
       in_game         = excluded.in_game,
       last_position   = excluded.last_position,
       last_error      = excluded.last_error,
       updated_at      = excluded.updated_at`,
  ).run(
    state.playerId,
    state.puuid,
    JSON.stringify(state.totals),
    JSON.stringify(state.championUsage),
    JSON.stringify(state.recentResults),
    state.startRank ? JSON.stringify(state.startRank) : null,
    state.currentRank ? JSON.stringify(state.currentRank) : null,
    state.profileIconId,
    state.summonerLevel,
    state.inGame ? 1 : 0,
    state.lastPosition,
    state.lastError,
    state.updatedAt ?? new Date().toISOString(),
  );
}

export function setLastPosition(
  db: Db,
  playerId: string,
  position: number,
): void {
  db.prepare(
    'UPDATE player_state SET last_position = ? WHERE player_id = ?',
  ).run(position, playerId);
}

export function isMatchProcessed(
  db: Db,
  playerId: string,
  matchId: string,
): boolean {
  return (
    db
      .prepare(
        'SELECT 1 FROM processed_matches WHERE player_id = ? AND match_id = ?',
      )
      .get(playerId, matchId) !== undefined
  );
}

export function markMatchProcessed(
  db: Db,
  playerId: string,
  matchId: string,
): void {
  db.prepare(
    'INSERT OR IGNORE INTO processed_matches (player_id, match_id, counted_at) VALUES (?, ?, ?)',
  ).run(playerId, matchId, new Date().toISOString());
}
