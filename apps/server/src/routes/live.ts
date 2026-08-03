import { Hono } from 'hono';

import { opggUrl } from '@challenge/core/domain';
import type { PlatformId } from '@challenge/core/riot';

import type { Db } from '../db/index';
import { activeGames, cachedRanks } from '../db/matches';
import { getPlayerState, listPlayers } from '../db/players';
import { gameAssets } from '../riot/assets';
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

export function liveRoutes(db: Db, challengeQueueId: number, platform: PlatformId) {
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

    const [names, assets] = await Promise.all([championNames(), gameAssets()]);
    const roster = listPlayers(db, 'approved');
    const byPuuid = new Map(
      roster.filter((player) => player.puuid).map((player) => [player.puuid!, player]),
    );

    // Roster ranks come from the state the cycle already keeps; everyone else
    // from the cache the cycle fills. One map so the shape is the same either way.
    const ranks = cachedRanks(
      db,
      games.flatMap(({ game }) => game.participants.map((p) => p.puuid)),
    );
    const rosterRanks = new Map(
      roster
        .filter((player) => player.puuid)
        .map((player) => [
          player.puuid!,
          getPlayerState(db, player.id)?.currentRank ?? null,
        ]),
    );

    return context.json({
      games: games.map(({ playerIds, game }) => {
        // Anchor on a tracked player so "our side" is a meaningful label.
        const anchor = game.participants.find((participant) =>
          byPuuid.has(participant.puuid),
        );

        const describe = (participant: (typeof game.participants)[number]) => {
          const tracked = byPuuid.get(participant.puuid);
          // A tracked player's own rank is fresher than anything the cache
          // holds, since the cycle reads it every minute.
          const own = tracked ? rosterRanks.get(participant.puuid) : null;
          const cached = ranks.get(participant.puuid);
          const rank = own
            ? { tier: own.tier, division: own.division, lp: own.leaguePoints }
            : cached
              ? { tier: cached.tier, division: cached.division, lp: cached.lp }
              : null;

          return {
            championId: participant.championId,
            championName: names.get(participant.championId) ?? `#${participant.championId}`,
            championIcon: championIcon(participant.championId),
            teamId: participant.teamId,
            riotId: participant.riotId,
            playerId: tracked?.id ?? null,
            displayName: tracked?.displayName ?? null,
            spellIcons: (participant.spellIds ?? [])
              .map((id) => assets.spells.get(id) ?? null)
              .filter((icon): icon is string => icon !== null),
            perkIcons: [participant.perkStyle, participant.perkSubStyle]
              .map((id) => (id ? (assets.styles.get(id) ?? null) : null))
              .filter((icon): icon is string => icon !== null),
            rank: rank?.tier ? rank : null,
            opggUrl: participant.riotId
              ? opggUrl(
                  platform,
                  participant.riotId.split('#')[0] ?? participant.riotId,
                  participant.riotId.split('#')[1] ?? '',
                )
              : null,
          };
        };

        const ours = anchor?.teamId ?? 100;

        return {
          gameId: game.gameId,
          queueId: game.queueId,
          queueLabel: QUEUE_LABEL[game.queueId] ?? `Queue ${game.queueId}`,
          gameLength: game.gameLength,
          // Absolute start time so the page can run its own clock instead of
          // showing a length frozen at the last sync.
          startedAt: game.startedAt ?? null,
          bans: (game.bans ?? []).map((ban) => ({
            teamId: ban.teamId,
            icon: championIcon(ban.championId),
            name: names.get(ban.championId) ?? `#${ban.championId}`,
          })),
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
