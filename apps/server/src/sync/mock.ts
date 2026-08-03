import {
  DIVISIONS,
  TIERS,
  toLadderPoints,
  type Rank,
  type Tier,
} from '@challenge/core/domain';

import type { Db } from '../db/index';
import {
  emptyTotals,
  getPlayerState,
  listPlayers,
  upsertPlayerState,
} from '../db/players';
import { MAX_RECENT_RESULTS } from './helpers';
import type { CycleReport } from './riot';

const APEX_FLOOR = TIERS.indexOf('MASTER') * 400;

const CHAMPION_POOL = [
  { id: 157, name: 'Yasuo' },
  { id: 64, name: 'LeeSin' },
  { id: 222, name: 'Jinx' },
  { id: 86, name: 'Garen' },
  { id: 412, name: 'Thresh' },
  { id: 103, name: 'Ahri' },
  { id: 254, name: 'Vi' },
  { id: 51, name: 'Caitlyn' },
  { id: 875, name: 'Sett' },
  { id: 202, name: 'Jhin' },
];

export function ladderPointsToRank(points: number): Rank {
  const clamped = Math.max(0, points);
  if (clamped >= APEX_FLOOR) {
    const lp = clamped - APEX_FLOOR;
    const tier: Tier =
      lp >= 1000 ? 'CHALLENGER' : lp >= 500 ? 'GRANDMASTER' : 'MASTER';
    return { tier, division: null, leaguePoints: Math.round(lp) };
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

/** Deterministic PRNG so a given player always starts from the same profile. */
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

/**
 * Advances every approved player by at most one simulated game. Lets the whole
 * stack — API, scheduler, frontend — be exercised without a Riot key.
 */
export function runMockCycle(db: Db): CycleReport {
  const started = Date.now();
  const players = listPlayers(db, 'approved');
  let newMatches = 0;

  for (const player of players) {
    const random = createRandom(`${player.id}:${player.gameName}`);
    let state = getPlayerState(db, player.id);

    if (!state) {
      const startPoints = Math.round(1200 + random() * 1800);
      state = {
        playerId: player.id,
        puuid: `mock-${player.id}`,
        totals: emptyTotals(),
        championUsage: {},
        recentResults: [],
        winStreak: 0,
        startRank: ladderPointsToRank(startPoints),
        currentRank: ladderPointsToRank(startPoints),
        profileIconId: 500 + Math.floor(random() * 100),
        summonerLevel: 100 + Math.floor(random() * 400),
        inGame: false,
        lastPosition: null,
        lastError: null,
        updatedAt: null,
      };
    }

    const playsThisTick = Math.random() < 0.5;
    if (playsThisTick) {
      newMatches += 1;
      const won = Math.random() < 0.42 + random() * 0.2;
      const durationMinutes = 22 + Math.random() * 16;

      state.totals = {
        games: state.totals.games + 1,
        wins: state.totals.wins + (won ? 1 : 0),
        losses: state.totals.losses + (won ? 0 : 1),
        kills: state.totals.kills + Math.round(Math.random() * 14),
        deaths: state.totals.deaths + 1 + Math.round(Math.random() * 8),
        assists: state.totals.assists + Math.round(Math.random() * 18),
        minutesPlayed: state.totals.minutesPlayed + durationMinutes,
        creepScore:
          state.totals.creepScore +
          Math.round(durationMinutes * (3 + Math.random() * 4)),
      };

      const champion =
        CHAMPION_POOL[Math.floor(Math.random() * CHAMPION_POOL.length)]!;
      const usage = state.championUsage[String(champion.id)] ?? {
        championId: champion.id,
        championName: champion.name,
        games: 0,
        wins: 0,
      };
      state.championUsage[String(champion.id)] = {
        ...usage,
        games: usage.games + 1,
        wins: usage.wins + (won ? 1 : 0),
      };

      state.recentResults = [won, ...state.recentResults].slice(
        0,
        MAX_RECENT_RESULTS,
      );
      state.winStreak = won ? state.winStreak + 1 : 0;

      const points =
        toLadderPoints(state.currentRank) +
        (won ? 16 + Math.random() * 10 : -(14 + Math.random() * 8));
      state.currentRank = ladderPointsToRank(Math.round(points));
    }

    state.inGame = Math.random() < 0.15;
    state.updatedAt = new Date().toISOString();
    upsertPlayerState(db, state);
  }

  return {
    players: players.length,
    updated: players.length,
    failed: 0,
    newMatches,
    durationMs: Date.now() - started,
  };
}
