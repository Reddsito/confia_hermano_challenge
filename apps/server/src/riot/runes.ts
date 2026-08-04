/**
 * The three rune trees, from Data Dragon.
 *
 * Same deal as the champion names next door: a static CDN with no key, so none
 * of this counts against the Riot rate limit, and the result is cached for a
 * day because trees only change on a patch.
 *
 * Icons are stored as full URLs so callers never have to know where the base
 * path lives.
 */
import type { RuneTree } from '@challenge/core/domain';

const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const CACHE_MS = 24 * 60 * 60 * 1000;

/** Data Dragon serves rune icons from a path-rooted CDN, not the versioned one. */
const ICON_BASE = 'https://ddragon.leagueoflegends.com/cdn/img/';

interface RawTree {
  id: number;
  name: string;
  icon: string;
  slots: Array<{
    runes: Array<{ id: number; name: string; icon: string }>;
  }>;
}

let cache: { trees: RuneTree[]; fetchedAt: number } | null = null;
let inFlight: Promise<RuneTree[]> | null = null;

async function load(): Promise<RuneTree[]> {
  const versions = (await (await fetch(VERSIONS_URL)).json()) as string[];
  const latest = versions[0];
  if (!latest) throw new Error('Data Dragon returned no versions');

  const payload = (await (
    await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${latest}/data/es_MX/runesReforged.json`,
    )
  ).json()) as RawTree[];

  return payload.map((tree) => ({
    id: tree.id,
    name: tree.name,
    icon: `${ICON_BASE}${tree.icon}`,
    slots: tree.slots.map((slot) => ({
      runes: slot.runes.map((rune) => ({
        id: rune.id,
        name: rune.name,
        icon: `${ICON_BASE}${rune.icon}`,
      })),
    })),
  }));
}

export async function runeTrees(): Promise<RuneTree[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.trees;

  // Concurrent callers share one request rather than each starting their own.
  inFlight ??= load()
    .then((trees) => {
      cache = { trees, fetchedAt: Date.now() };
      return trees;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch (error) {
    console.warn('[runes] could not load rune trees:', error);
    // Stale beats nothing; empty makes rollRunePage return null rather than
    // inventing a page that cannot be typed into the client.
    return cache?.trees ?? [];
  }
}

export interface RuneIndex {
  trees: RuneTree[];
  /** Rune and tree id to name, for embeds that can only render text. */
  names: Map<number, string>;
  icons: Map<number, string>;
}

/** Flattened lookup, so a stored page can be printed without walking the trees. */
export async function runeIndex(): Promise<RuneIndex> {
  const trees = await runeTrees();
  const names = new Map<number, string>();
  const icons = new Map<number, string>();

  for (const tree of trees) {
    names.set(tree.id, tree.name);
    icons.set(tree.id, tree.icon);
    for (const slot of tree.slots) {
      for (const rune of slot.runes) {
        names.set(rune.id, rune.name);
        icons.set(rune.id, rune.icon);
      }
    }
  }

  return { trees, names, icons };
}

/**
 * Shard labels, which Data Dragon does not describe at all — the shards are not
 * part of any tree, so they are named here to match what the client shows.
 */
export const SHARD_LABEL: Record<number, string> = {
  5001: 'Salud escalada',
  5005: 'Velocidad de ataque',
  5007: 'Aceleración de habilidad',
  5008: 'Fuerza adaptable',
  5010: 'Velocidad de movimiento',
  5011: 'Salud',
  5013: 'Tenacidad y resistencia a ralentizaciones',
};
