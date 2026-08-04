/**
 * Rendering a roll as text.
 *
 * Discord embeds carry a single image, so nine rune icons cannot be drawn one
 * by one — the page is written out instead, and the link on the embed leads to
 * the illustrated version on the site. This module is what both of those share.
 */
import type { RunePage } from '@challenge/core/domain';

import { championName } from '../riot/champions';
import { runeIndex, SHARD_LABEL } from '../riot/runes';
import type { ShellPayload } from '../db/shells';

export interface DescribedField {
  name: string;
  value: string;
  inline?: boolean;
}

async function describeRunes(page: RunePage): Promise<DescribedField[]> {
  const { names } = await runeIndex();
  const label = (id: number) => names.get(id) ?? SHARD_LABEL[id] ?? `#${id}`;

  const [keystone, ...minor] = page.primary;

  return [
    {
      name: `${label(page.primaryStyle)} (principal)`,
      value: [
        `**${keystone === undefined ? '—' : label(keystone)}**`,
        ...minor.map(label),
      ].join('\n'),
      inline: true,
    },
    {
      name: `${label(page.secondaryStyle)} (secundario)`,
      value: page.secondary.map(label).join('\n') || '—',
      inline: true,
    },
    {
      name: 'Fragmentos',
      value: page.shards.map(label).join(' · '),
      inline: false,
    },
  ];
}

/** Embed fields for whatever the challenge rolled, or none for a plain one. */
export async function describePayload(
  payload: ShellPayload | null,
): Promise<DescribedField[]> {
  if (!payload) return [];

  if (payload.kind === 'RANDOM_CHAMPION') {
    return [
      {
        name: 'Te toca',
        value: `**${await championName(payload.championId)}**`,
        inline: false,
      },
    ];
  }

  return describeRunes(payload.page);
}
