import {
  buildRanking,
  opggUrl,
  type PlayerEntry,
  type Snapshot,
} from '@challenge/core/domain';

import type { ServerConfig } from './config';
import { getMeta, setMeta, type Db } from './db/index';
import {
  dailyDeltas,
  extraTotalsFor,
  headToHead,
  lpSeries,
} from './db/matches';
import {
  emptyTotals,
  listPlayerStates,
  listPlayers,
  setLastPosition,
} from './db/players';
import { newLeaderEmbed } from './discord/embeds';
import type { DiscordNotifier } from './discord/notifier';
import { computeStreak, topChampions } from './sync/helpers';

const LEADER_KEY = 'current_leader';

export const LAST_CYCLE_KEY = 'last_cycle_at';

/**
 * Projects the database into the exact JSON contract the frontend already
 * consumes. Keeping this shape stable is what let the site move from a static
 * file to an API without touching a single component.
 */
export function buildSnapshot(db: Db, config: ServerConfig): Snapshot {
  const players = listPlayers(db, 'approved');
  const states = listPlayerStates(db);

  const entries: PlayerEntry[] = players.map((player) => {
    const state = states.get(player.id);

    return {
      id: player.id,
      displayName: player.displayName,
      gameName: player.gameName,
      tagLine: player.tagLine,
      role: player.role,
      puuid: state?.puuid ?? player.puuid,
      profileIconId: state?.profileIconId ?? null,
      summonerLevel: state?.summonerLevel ?? null,
      rank: state?.currentRank ?? null,
      startRank: state?.startRank ?? null,
      totals: state?.totals ?? emptyTotals(),
      topChampions: state ? topChampions(state.championUsage) : [],
      streak: computeStreak(state?.recentResults ?? []),
      recentResults: state?.recentResults ?? [],
      previousPosition: state?.lastPosition ?? null,
      inGame: state?.inGame ?? false,
      error: state?.lastError ?? null,
      extras: extraTotalsFor(db, player.id),
    };
  });

  const generatedAt = getMeta(db, LAST_CYCLE_KEY) ?? new Date().toISOString();
  const nextUpdateAt = new Date(
    Date.parse(generatedAt) + config.tournament.refreshIntervalMinutes * 60_000,
  ).toISOString();

  return {
    version: 1,
    generatedAt,
    nextUpdateAt,
    source: config.useMockData ? 'mock' : 'riot',
    tournament: config.tournament,
    players: entries,
    headToHead: headToHead(db),
    dailyDeltas: dailyDeltas(db),
    lpSeries: lpSeries(db),
  };
}

/**
 * Stores where everyone finished so the next snapshot can render movement
 * arrows. Position is a property of the whole field, so it is only knowable
 * after a cycle completes.
 */
export function recordPositions(
  db: Db,
  config: ServerConfig,
  notifier?: DiscordNotifier,
): void {
  const snapshot = buildSnapshot(db, config);
  const ranking = buildRanking(snapshot);

  db.transaction(() => {
    for (const player of ranking) {
      setLastPosition(db, player.id, player.position);
    }
  })();

  const leader = ranking[0];
  if (!leader || !notifier) return;

  const previousId = getMeta(db, LEADER_KEY);
  if (previousId === leader.id) return;

  // Skip the very first cycle: there was no leader to take the spot from, so
  // announcing one would just be noise on startup.
  if (previousId) {
    const previous = ranking.find((player) => player.id === previousId);
    notifier.push(
      'new_leader',
      newLeaderEmbed(
        {
          id: leader.id,
          displayName: leader.displayName,
          gameName: leader.gameName,
          tagLine: leader.tagLine,
          role: leader.role,
          status: 'approved',
          puuid: leader.puuid,
          createdAt: '',
        },
        leader.rank,
        previous?.displayName ?? null,
        {
          tournamentName: config.tournament.name,
          siteUrl: config.siteUrl || undefined,
          opggUrl: opggUrl(config.platform, leader.gameName, leader.tagLine),
          profileIconId: leader.profileIconId,
        },
      ),
    );
  }

  setMeta(db, LEADER_KEY, leader.id);
}

export function markCycleComplete(db: Db): void {
  setMeta(db, LAST_CYCLE_KEY, new Date().toISOString());
}
