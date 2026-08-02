import type { MockOverride, TournamentConfig } from '../domain/config';
import { toLadderPoints } from '../domain/ranking';
import type { PlayerEntry, Rank, Snapshot, Tier } from '../domain/types';
import { DIVISIONS, TIERS } from '../domain/types';
import {
  computeStreak,
  emptyPlayerState,
  topChampions,
  type PlayerState,
  type WorkerState,
} from './state';
import { toMeta } from './riot';

const MAX_RECENT_RESULTS = 20;
const APEX_FLOOR = TIERS.indexOf('MASTER') * 400;

const CHAMPION_POOL: Array<{ id: number; name: string }> = [
  { id: 157, name: 'Yasuo' },
  { id: 64, name: 'LeeSin' },
  { id: 222, name: 'Jinx' },
  { id: 86, name: 'Garen' },
  { id: 412, name: 'Thresh' },
  { id: 103, name: 'Ahri' },
  { id: 254, name: 'Vi' },
  { id: 51, name: 'Caitlyn' },
  { id: 875, name: 'Sett' },
  { id: 350, name: 'Yuumi' },
  { id: 245, name: 'Ekko' },
  { id: 202, name: 'Jhin' },
];

/**
 * Deterministic PRNG so a given seed always produces the same player, which
 * makes the mock leaderboard stable between dev-server restarts.
 */
function createRandom(seed: string): () => number {
  let hash = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    hash ^= seed.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return () => {
    hash += 0x6d2b79f5;
    let t = hash;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function ladderPointsToRank(points: number): Rank {
  const clamped = Math.max(0, points);
  if (clamped >= APEX_FLOOR) {
    const lp = clamped - APEX_FLOOR;
    const tier: Tier =
      lp >= 1000 ? 'CHALLENGER' : lp >= 500 ? 'GRANDMASTER' : 'MASTER';
    return { tier, division: null, leaguePoints: lp };
  }

  const tierIndex = Math.min(Math.floor(clamped / 400), TIERS.length - 1);
  const withinTier = clamped - tierIndex * 400;
  const divisionIndex = Math.min(Math.floor(withinTier / 100), 3);

  return {
    tier: TIERS[tierIndex]!,
    division: DIVISIONS[divisionIndex]!,
    leaguePoints: Math.round(withinTier - divisionIndex * 100),
  };
}

/**
 * Simulates a plausible leaderboard so the UI can be built and reviewed before
 * a Riot key exists. Each call advances every player by a few games.
 */
export function generateMockSnapshot(
  config: TournamentConfig,
  previous: WorkerState,
): { snapshot: Snapshot; state: WorkerState } {
  const state: WorkerState = { ...previous, players: { ...previous.players } };
  const entries: PlayerEntry[] = [];

  config.players.forEach((player, playerIndex) => {
    const random = createRandom(`${player.id}:${player.gameName}`);
    const existing = state.players[player.id];
    // A fixture is authoritative: rebuild it every cycle so editing the config
    // takes effect immediately instead of losing to stale state on disk. Only
    // the previous position is carried over, so movement arrows still work.
    const playerState: PlayerState = player.mock
      ? { ...pinPlayer(player.id, player.mock, random), lastPosition: existing?.lastPosition ?? null }
      : existing
        ? { ...existing }
        : seedPlayer(player.id, random, playerIndex);

    // A pinned player is a fixture, not a simulation — leave it exactly as
    // configured so the demo roster keeps the shape it was written to show.
    const gamesThisTick = player.mock ? 0 : Math.random() < 0.45 ? 1 : 0;
    let points = toLadderPoints(playerState.simulatedRank ?? null);

    for (let game = 0; game < gamesThisTick; game += 1) {
      const skill = 0.42 + random() * 0.2;
      const won = Math.random() < skill;
      const durationMinutes = 22 + Math.random() * 16;

      playerState.totals = {
        games: playerState.totals.games + 1,
        wins: playerState.totals.wins + (won ? 1 : 0),
        losses: playerState.totals.losses + (won ? 0 : 1),
        kills: playerState.totals.kills + Math.round(Math.random() * 14),
        deaths: playerState.totals.deaths + 1 + Math.round(Math.random() * 8),
        assists: playerState.totals.assists + Math.round(Math.random() * 18),
        minutesPlayed: playerState.totals.minutesPlayed + durationMinutes,
        creepScore:
          playerState.totals.creepScore +
          Math.round(durationMinutes * (3 + Math.random() * 4)),
      };

      const champion =
        CHAMPION_POOL[Math.floor(Math.random() * CHAMPION_POOL.length)]!;
      const usage = playerState.championUsage[String(champion.id)] ?? {
        championId: champion.id,
        championName: champion.name,
        games: 0,
        wins: 0,
      };
      playerState.championUsage = {
        ...playerState.championUsage,
        [String(champion.id)]: {
          ...usage,
          games: usage.games + 1,
          wins: usage.wins + (won ? 1 : 0),
        },
      };

      playerState.recentResults = [won, ...playerState.recentResults].slice(
        0,
        MAX_RECENT_RESULTS,
      );
      points += won ? 16 + Math.random() * 10 : -(14 + Math.random() * 8);
    }

    const rank = player.mock
      ? ladderPointsToRank(player.mock.ladderPoints)
      : ladderPointsToRank(Math.round(points));
    playerState.simulatedRank = rank;
    state.players[player.id] = playerState;

    entries.push({
      id: player.id,
      displayName: player.displayName,
      gameName: player.gameName,
      tagLine: player.tagLine,
      role: player.role,
      puuid: `mock-${player.id}`,
      profileIconId: 500 + Math.floor(random() * 100),
      summonerLevel: 100 + Math.floor(random() * 500),
      rank,
      startRank: playerState.startRank,
      totals: playerState.totals,
      topChampions: topChampions(playerState.championUsage),
      streak: computeStreak(playerState.recentResults),
      recentResults: playerState.recentResults,
      previousPosition: playerState.lastPosition ?? null,
      inGame: player.mock ? false : Math.random() < 0.15,
      error: null,
    });
  });

  const generatedAt = new Date();
  const nextUpdateAt = new Date(
    generatedAt.getTime() + config.refreshIntervalMinutes * 60_000,
  );

  return {
    snapshot: {
      version: 1,
      generatedAt: generatedAt.toISOString(),
      nextUpdateAt: nextUpdateAt.toISOString(),
      source: 'mock',
      tournament: toMeta(config),
      players: entries,
    },
    state,
  };
}

function seedPlayer(
  id: string,
  random: () => number,
  playerIndex: number,
): PlayerState {
  const base = emptyPlayerState(`mock-${id}`);

  // Spread starting ranks from Gold up to low Master.
  const startPoints = Math.round(1300 + random() * 1600 + playerIndex * 30);
  const startRank = ladderPointsToRank(startPoints);

  const games = 20 + Math.floor(random() * 60);
  const wins = Math.round(games * (0.4 + random() * 0.2));
  const minutesPlayed = games * (24 + random() * 8);

  base.startRank = startRank;
  base.simulatedRank = ladderPointsToRank(
    startPoints + Math.round((random() - 0.35) * 700),
  );
  base.totals = {
    games,
    wins,
    losses: games - wins,
    kills: Math.round(games * (4 + random() * 6)),
    deaths: Math.round(games * (3 + random() * 4)),
    assists: Math.round(games * (5 + random() * 9)),
    minutesPlayed,
    creepScore: Math.round(minutesPlayed * (3.5 + random() * 3)),
  };
  base.recentResults = Array.from({ length: 10 }, () => random() < 0.5);

  const poolSize = 2 + Math.floor(random() * 2);
  for (let index = 0; index < poolSize; index += 1) {
    const champion =
      CHAMPION_POOL[Math.floor(random() * CHAMPION_POOL.length)]!;
    const championGames = 3 + Math.floor(random() * 15);
    base.championUsage[String(champion.id)] = {
      championId: champion.id,
      championName: champion.name,
      games: championGames,
      wins: Math.round(championGames * (0.35 + random() * 0.3)),
    };
  }

  return base;
}


/**
 * Builds a fixture from explicit wins and losses. Per-game numbers are derived
 * deterministically from the seed so the KDA and CS columns stay plausible
 * rather than empty.
 */
function pinPlayer(
  id: string,
  override: MockOverride,
  random: () => number,
): PlayerState {
  const base = emptyPlayerState(`mock-${id}`);
  const games = override.wins + override.losses;
  const minutesPlayed = games * (24 + random() * 8);

  base.startRank = ladderPointsToRank(
    override.startLadderPoints ?? override.ladderPoints,
  );
  base.simulatedRank = ladderPointsToRank(override.ladderPoints);
  base.totals = {
    games,
    wins: override.wins,
    losses: override.losses,
    kills: Math.round(games * (4 + random() * 6)),
    deaths: Math.round(games * (3 + random() * 4)),
    assists: Math.round(games * (5 + random() * 9)),
    minutesPlayed,
    creepScore: Math.round(minutesPlayed * (3.5 + random() * 3)),
  };

  // Recent form mirrors the overall record, newest first.
  const recent = Math.min(games, MAX_RECENT_RESULTS);
  const recentWins = Math.round((override.wins / Math.max(games, 1)) * recent);
  base.recentResults = Array.from({ length: recent }, (_, i) => i < recentWins);

  const champion = CHAMPION_POOL[Math.floor(random() * CHAMPION_POOL.length)]!;
  base.championUsage[String(champion.id)] = {
    championId: champion.id,
    championName: champion.name,
    games,
    wins: override.wins,
  };

  return base;
}
