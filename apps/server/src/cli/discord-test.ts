import { opggUrl } from '@challenge/core/domain';

import { listPlayers } from '../db/players';
import {
  challengeServedEmbed,
  inGameEmbed,
  matchFinishedEmbed,
  newLeaderEmbed,
  rankChangeEmbed,
  shellThrowEmbed,
} from '../discord/embeds';
import { DiscordNotifier } from '../discord/notifier';
import { bootstrap } from './bootstrap';

/**
 * Posts one of every message type so the channel can be seen before the first
 * real event fires. With no webhook configured it prints the payloads instead,
 * which is enough to iterate on the wording.
 */
const { config, db } = bootstrap();

const player = listPlayers(db, 'approved')[0] ?? {
  id: 'sample',
  displayName: 'Reddsito',
  gameName: 'Reddsito',
  tagLine: 'LAN',
  role: 'MID' as const,
  status: 'approved' as const,
  puuid: null,
  createdAt: '',
};

const rank = { tier: 'GOLD' as const, division: 'II' as const, leaguePoints: 47 };
const previousRank = { tier: 'GOLD' as const, division: 'III' as const, leaguePoints: 88 };

const context = {
  tournamentName: config.tournament.name,
  siteUrl: config.siteUrl || undefined,
  opggUrl: opggUrl(config.platform, player.gameName, player.tagLine),
  profileIconId: 5123,
};

const samples = [
  ['match_finished', matchFinishedEmbed(
    player,
    {
      playerId: player.id,
      matchId: 'SAMPLE',
      playedAt: Date.now(),
      durationMinutes: 31.4,
      teamId: 100,
      win: true,
      championId: 103,
      championName: 'Ahri',
      kills: 12,
      deaths: 2,
      assists: 9,
      creepScore: 241,
      goldEarned: 15320,
      damageToChampions: 31450,
      damageTaken: 18900,
      visionScore: 24,
      timeDeadSeconds: 62,
      pentaKills: 1,
      quadraKills: 0,
      tripleKills: 1,
      largestSpree: 7,
      soloKills: 3,
      firstBlood: true,
      surrendered: false,
      killParticipation: 0.68,
      usedSmite: false,
    },
    rank,
    18,
    context,
  )],
  ['rank_change', rankChangeEmbed(player, previousRank, rank, true, context)],
  ['new_leader', newLeaderEmbed(player, rank, 'becksito', context)],
  ['in_game', inGameEmbed(player, rank, context, {
    allies: ['**Ahri**', 'Lee Sin', 'Jinx', 'Thresh', 'Garen'],
    enemies: ['Yasuo', 'Vi', 'Caitlyn', 'Yuumi', 'Sett'],
  })],
  ['shell_thrown', shellThrowEmbed('becksito', player.displayName, 'Juega de support la próxima', 'Aunque no sea tu rol', context)],
  ['challenge_served', challengeServedEmbed(player.displayName, 'Sin usar el chat toda la partida', true, context)],
] as const;

if (!config.discord) {
  console.log('\nDISCORD_WEBHOOK_URL is not set — printing the payloads instead.\n');
  for (const [event, embed] of samples) {
    console.log(`--- ${event} ---`);
    console.log(JSON.stringify(embed, null, 2));
    console.log();
  }
  db.close();
  process.exit(0);
}

// Send everything regardless of DISCORD_EVENTS: the point of this command is to
// see all four, even the ones that are muted in normal operation.
const notifier = new DiscordNotifier({
  ...config.discord,
  events: new Set(samples.map(([event]) => event)),
});

for (const [event, embed] of samples) notifier.push(event, embed);
await notifier.flush();

console.log(`\n[discord] sent ${samples.length} sample messages\n`);
db.close();
