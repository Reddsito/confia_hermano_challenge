import { RiotClient } from '@challenge/core/riot';

import { earnedShells } from '@challenge/core/domain';

import { QUEUE_IDS } from '../config';
import { insertPlayerMatch } from '../db/matches';
import { listPlayers } from '../db/players';
import { awardShells } from '../db/shells';
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

const force = process.argv.includes('--force');

const alreadyStored = force
  ? new Set<string>()
  : new Set(
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
    if (!me || durationMinutes < 5 || match.info.queueId !== queueId) {
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
      usedSmite: me.summoner1Id === 11 || me.summoner2Id === 11,
      queueId: match.info.queueId,
    }, force);
    added += 1;
  }
}

console.log(`\n[backfill] ${added} matches stored, ${skipped} skipped`);

// Replay the shell rules over everything on record. Awarding is idempotent, so
// this both fills in history and is safe to re-run.
let shells = 0;
for (const player of listPlayers(db, 'approved')) {
  const games = db
    .prepare(
      `SELECT match_id, win, kills, deaths, assists, duration_minutes,
              penta_kills, quadra_kills, champion_id, used_smite
       FROM player_matches WHERE player_id = ? ORDER BY played_at ASC`,
    )
    .all(player.id) as Array<Record<string, number | string>>;

  let winStreak = 0;
  const winningChampions = new Set<number>();
  let smiteWins = 0;

  for (const game of games) {
    const win = game.win === 1;
    const usedSmite = game.used_smite === 1;

    winStreak = win ? winStreak + 1 : 0;
    if (win) winningChampions.add(game.champion_id as number);
    if (win && usedSmite) smiteWins += 1;

    const earned = earnedShells(
      {
        win,
        kills: game.kills as number,
        deaths: game.deaths as number,
        assists: game.assists as number,
        durationMinutes: game.duration_minutes as number,
        pentaKills: game.penta_kills as number,
        quadraKills: game.quadra_kills as number,
        championId: game.champion_id as number,
        usedSmite,
      },
      {
        winStreak,
        distinctChampionWins: winningChampions.size,
        smiteWins,
      },
    );

    shells += awardShells(db, player.id, game.match_id as string, earned);
  }
}

console.log(`[backfill] ${shells} blue shells awarded from history\n`);
db.close();
