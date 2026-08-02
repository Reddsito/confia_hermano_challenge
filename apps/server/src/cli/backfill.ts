import { RiotClient } from '@challenge/core/riot';

import { QUEUE_IDS } from '../config';
import { insertPlayerMatch } from '../db/matches';
import { listPlayers } from '../db/players';
import { bootstrap } from './bootstrap';

/**
 * Re-downloads matches that were counted before the per-match table existed.
 *
 * The running totals are left alone — they already include these games. This
 * only fills in the detailed columns (time dead, vision, multikills, kill
 * participation) that the aggregate counters never had room for.
 *
 * Only useful once, after adding the detailed stats. Riot's match history is a
 * moving window, so anything older than that window is gone for good.
 */
const { config, db } = bootstrap();

if (config.useMockData) {
  console.error('Backfill needs real data. Set DATA_SOURCE=riot.\n');
  db.close();
  process.exit(1);
}

const client = new RiotClient(config.riotApiKey, config.platform);
const queueId = QUEUE_IDS[config.tournament.queue] ?? 420;
const startTime = Math.floor(Date.parse(config.tournament.startsAt) / 1000);

const alreadyStored = new Set(
  (
    db.prepare('SELECT player_id, match_id FROM player_matches').all() as Array<{
      player_id: string;
      match_id: string;
    }>
  ).map((row) => `${row.player_id}:${row.match_id}`),
);

let added = 0;
let skipped = 0;

for (const player of listPlayers(db, 'approved')) {
  if (!player.puuid) {
    console.log(`  skip ${player.displayName}: no PUUID resolved yet`);
    continue;
  }

  const matchIds = await client.getMatchIds(player.puuid, {
    queue: queueId,
    startTime,
    count: 100,
  });

  const missing = matchIds.filter(
    (id) => !alreadyStored.has(`${player.id}:${id}`),
  );

  console.log(
    `  ${player.displayName}: ${matchIds.length} in history, ${missing.length} to backfill`,
  );

  for (const matchId of missing) {
    const match = await client.getMatch(matchId);
    const me = match.info.participants.find(
      (participant) => participant.puuid === player.puuid,
    );

    const durationMinutes = match.info.gameDuration / 60;
    if (!me || durationMinutes < 5) {
      skipped += 1;
      continue;
    }

    insertPlayerMatch(db, {
      playerId: player.id,
      matchId,
      playedAt: match.info.gameCreation,
      durationMinutes,
      teamId: me.teamId,
      win: me.win,
      championId: me.championId,
      championName: me.championName,
      kills: me.kills,
      deaths: me.deaths,
      assists: me.assists,
      creepScore: me.totalMinionsKilled + me.neutralMinionsKilled,
      goldEarned: me.goldEarned ?? 0,
      damageToChampions: me.totalDamageDealtToChampions ?? 0,
      damageTaken: me.totalDamageTaken ?? 0,
      visionScore: me.visionScore ?? 0,
      timeDeadSeconds: me.totalTimeSpentDead ?? 0,
      pentaKills: me.pentaKills ?? 0,
      quadraKills: me.quadraKills ?? 0,
      tripleKills: me.tripleKills ?? 0,
      largestSpree: me.largestKillingSpree ?? 0,
      soloKills: me.challenges?.soloKills ?? 0,
      firstBlood: Boolean(me.firstBloodKill),
      surrendered: Boolean(me.gameEndedInSurrender),
      killParticipation: me.challenges?.killParticipation ?? null,
    });
    added += 1;
  }
}

console.log(`\n[backfill] ${added} matches stored, ${skipped} skipped\n`);
db.close();
