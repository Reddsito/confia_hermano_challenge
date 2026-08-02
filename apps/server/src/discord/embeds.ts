import { formatRank, tierColorInt, type Rank } from '@challenge/core/domain';

import type { PlayerMatchRow } from '../db/matches';
import type { PlayerRow } from '../db/players';

const DDRAGON_VERSION = '15.15.1';

export interface DiscordEmbed {
  title?: string;
  description?: string;
  color?: number;
  url?: string;
  timestamp?: string;
  author?: { name: string; icon_url?: string; url?: string };
  thumbnail?: { url: string };
  fields?: Array<{ name: string; value: string; inline?: boolean }>;
  footer?: { text: string; icon_url?: string };
}

function profileIcon(iconId: number | null): string | undefined {
  if (iconId === null) return undefined;
  return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/profileicon/${iconId}.png`;
}

function championIcon(name: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${name}.png`;
}

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m`;
  return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
}

function signed(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export interface EmbedContext {
  tournamentName: string;
  siteUrl?: string;
  opggUrl: string;
  profileIconId: number | null;
}

/** Someone just queued up. Short and quiet — this fires often. */
export function inGameEmbed(
  player: PlayerRow,
  rank: Rank | null,
  context: EmbedContext,
): DiscordEmbed {
  return {
    color: tierColorInt(rank),
    author: {
      name: `${player.displayName} entró en partida`,
      icon_url: profileIcon(context.profileIconId),
      url: context.opggUrl,
    },
    description: rank ? `Ahora mismo en **${formatRank(rank)}**` : undefined,
    footer: { text: context.tournamentName },
    timestamp: new Date().toISOString(),
  };
}

/** A game finished. This is the one people actually read, so it carries detail. */
export function matchFinishedEmbed(
  player: PlayerRow,
  match: PlayerMatchRow,
  rank: Rank | null,
  lpDelta: number | null,
  context: EmbedContext,
): DiscordEmbed {
  const kda = ((match.kills + match.assists) / Math.max(match.deaths, 1)).toFixed(2);
  const verdict = match.win ? 'Victoria' : 'Derrota';

  const fields: DiscordEmbed['fields'] = [
    {
      name: 'KDA',
      value: `**${match.kills}** / **${match.deaths}** / **${match.assists}**  ·  ${kda}`,
      inline: true,
    },
    {
      name: 'CS',
      value: `${match.creepScore} (${(match.creepScore / Math.max(match.durationMinutes, 1)).toFixed(1)}/min)`,
      inline: true,
    },
    {
      name: 'Duración',
      value: `${Math.round(match.durationMinutes)} min`,
      inline: true,
    },
  ];

  if (rank) {
    fields.push({
      name: 'Elo',
      value:
        lpDelta === null || lpDelta === 0
          ? formatRank(rank)
          : `${formatRank(rank)}  (${signed(lpDelta)} LP)`,
      inline: false,
    });
  }

  // Rare enough that mentioning it is a genuine event, not noise.
  const highlights: string[] = [];
  if (match.pentaKills > 0) highlights.push('**PENTAKILL**');
  else if (match.quadraKills > 0) highlights.push('Quadra kill');
  if (match.deaths === 0 && match.durationMinutes > 15) highlights.push('Sin morir');
  if (match.timeDeadSeconds > 300)
    highlights.push(`${formatDuration(match.timeDeadSeconds)} muerto`);

  if (highlights.length > 0) {
    fields.push({ name: '​', value: highlights.join(' · '), inline: false });
  }

  return {
    color: match.win ? 0x0fa892 : 0xec3a5e,
    author: {
      name: `${player.displayName} · ${verdict}`,
      icon_url: profileIcon(context.profileIconId),
      url: context.opggUrl,
    },
    title: match.championName,
    thumbnail: { url: championIcon(match.championName) },
    fields,
    footer: { text: context.tournamentName },
    timestamp: new Date(match.playedAt).toISOString(),
  };
}

/** Tier or division changed. Worth a louder message than a normal game. */
export function rankChangeEmbed(
  player: PlayerRow,
  from: Rank | null,
  to: Rank,
  promoted: boolean,
  context: EmbedContext,
): DiscordEmbed {
  return {
    color: tierColorInt(to),
    author: {
      name: player.displayName,
      icon_url: profileIcon(context.profileIconId),
      url: context.opggUrl,
    },
    title: promoted ? `Ascendió a ${formatRank(to)}` : `Bajó a ${formatRank(to)}`,
    description: from ? `Venía de ${formatRank(from)}` : undefined,
    footer: { text: context.tournamentName },
    timestamp: new Date().toISOString(),
  };
}

/** The top of the table changed hands. */
export function newLeaderEmbed(
  player: PlayerRow,
  rank: Rank | null,
  previousLeader: string | null,
  context: EmbedContext,
): DiscordEmbed {
  return {
    color: tierColorInt(rank),
    author: {
      name: 'Nuevo líder del challenge',
      icon_url: profileIcon(context.profileIconId),
    },
    title: player.displayName,
    description: previousLeader
      ? `Le sacó el primer puesto a **${previousLeader}**${rank ? ` con ${formatRank(rank)}` : ''}.`
      : `Primer puesto${rank ? ` con ${formatRank(rank)}` : ''}.`,
    url: context.siteUrl,
    footer: { text: context.tournamentName },
    timestamp: new Date().toISOString(),
  };
}
