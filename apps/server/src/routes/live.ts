import { Hono } from 'hono';

import type { Db } from '../db/index';
import { activeGames } from '../db/matches';
import { listPlayers } from '../db/players';
import { championNames } from '../riot/champions';

/** CommunityDragon serves icons by numeric id, so no name lookup is needed. */
function championIcon(championId: number): string {
  return (
    'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/' +
    `global/default/v1/champion-icons/${championId}.png`
  );
}

const QUEUE_LABEL: Record<number, string> = {
  0: 'Custom',
  400: 'Normal Draft',
  420: 'Ranked Solo/Duo',
  430: 'Normal Blind',
  440: 'Ranked Flex',
  450: 'ARAM',
  490: 'Quickplay',
  700: 'Clash',
  1700: 'Arena',
  3100: 'Custom',
};

export function liveRoutes(db: Db, challengeQueueId: number) {
  const app = new Hono();

  /**
   * Live games as of the last sync cycle.
   *
   * Served from stored state rather than from Riot: the cycle already asks
   * SPECTATOR-V5 once per player, so a busy page costs nothing extra. The
   * trade-off is freshness, which is why the age is returned explicitly.
   */
  app.get('/', async (context) => {
    const games = activeGames(db);
    if (games.length === 0) return context.json({ games: [] });

    const names = await championNames();
    const roster = listPlayers(db, 'approved');
    const byPuuid = new Map(
      roster.filter((player) => player.puuid).map((player) => [player.puuid!, player]),
    );

    return context.json({
      games: games.map(({ playerIds, game }) => {
        // Anchor on a tracked player so "our side" is a meaningful label.
        const anchor = game.participants.find((participant) =>
          byPuuid.has(participant.puuid),
        );

        const describe = (participant: (typeof game.participants)[number]) => {
          const tracked = byPuuid.get(participant.puuid);
          return {
            championId: participant.championId,
            championName: names.get(participant.championId) ?? `#${participant.championId}`,
            championIcon: championIcon(participant.championId),
            teamId: participant.teamId,
            riotId: participant.riotId,
            playerId: tracked?.id ?? null,
            displayName: tracked?.displayName ?? null,
          };
        };

        const ours = anchor?.teamId ?? 100;

        return {
          gameId: game.gameId,
          queueId: game.queueId,
          queueLabel: QUEUE_LABEL[game.queueId] ?? `Queue ${game.queueId}`,
          gameLength: game.gameLength,
          // Riot reports a negative length during champion select, before the
          // clock starts. Surfaced rather than clamped, so the UI can say so.
          inChampSelect: game.gameLength < 0,
          countsForChallenge: game.queueId === challengeQueueId,
          trackedPlayerIds: playerIds,
          allies: game.participants
            .filter((participant) => participant.teamId === ours)
            .map(describe),
          enemies: game.participants
            .filter((participant) => participant.teamId !== ours)
            .map(describe),
        };
      }),
    });
  });

  return app;
}
