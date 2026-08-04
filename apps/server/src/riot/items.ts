/**
 * Buildable items, from Data Dragon.
 *
 * Same static CDN and daily cache as the champions and runes next door, so
 * none of this costs anything against the Riot rate limit.
 *
 * The filtering is the substance here. Data Dragon's item file is everything
 * that has ever had an id: consumables, trinkets, components, jungle pets,
 * Arena-only items and things removed patches ago. Rolling over it raw would
 * hand somebody a build of three health potions and a stealth ward, so the pool
 * is cut down to items you could actually finish a game holding.
 */
const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const CACHE_MS = 24 * 60 * 60 * 1000;

/** Summoner's Rift. The board a solo queue challenge is played on. */
const SUMMONERS_RIFT = '11';

/**
 * Cheapest thing that counts as a finished item. Tier-two boots sit around
 * 1000, so this keeps them and drops the components underneath.
 */
const MIN_GOLD = 1000;

export interface ItemInfo {
  id: number;
  name: string;
  icon: string;
  gold: number;
  /** Boots are capped at one per build, so they have to be recognisable. */
  isBoots: boolean;
}

interface RawItem {
  name: string;
  gold: { total: number; purchasable: boolean };
  tags?: string[];
  maps?: Record<string, boolean>;
  into?: string[];
  requiredAlly?: string;
  inStore?: boolean;
  image: { full: string };
}

let cache: { items: ItemInfo[]; fetchedAt: number } | null = null;
let inFlight: Promise<ItemInfo[]> | null = null;

async function load(): Promise<ItemInfo[]> {
  const versions = (await (await fetch(VERSIONS_URL)).json()) as string[];
  const latest = versions[0];
  if (!latest) throw new Error('Data Dragon returned no versions');

  const payload = (await (
    await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${latest}/data/es_MX/item.json`,
    )
  ).json()) as { data: Record<string, RawItem> };

  const items: ItemInfo[] = [];

  for (const [key, item] of Object.entries(payload.data)) {
    const tags = item.tags ?? [];

    // `into` non-empty means something builds out of it, which is the
    // definition of a component. Kept out so a build is six finished items.
    if (item.into && item.into.length > 0) continue;
    if (!item.gold?.purchasable) continue;
    if (item.inStore === false) continue;
    if (!item.maps?.[SUMMONERS_RIFT]) continue;
    if (item.gold.total < MIN_GOLD) continue;
    if (tags.includes('Consumable') || tags.includes('Trinket')) continue;
    // Ornn's masterwork upgrades: nobody can buy these on their own.
    if (item.requiredAlly) continue;

    items.push({
      id: Number(key),
      name: item.name,
      icon: `https://ddragon.leagueoflegends.com/cdn/${latest}/img/item/${item.image.full}`,
      gold: item.gold.total,
      isBoots: tags.includes('Boots'),
    });
  }

  return items;
}

export async function buildableItems(): Promise<ItemInfo[]> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.items;

  inFlight ??= load()
    .then((items) => {
      cache = { items, fetchedAt: Date.now() };
      return items;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch (error) {
    console.warn('[items] could not load items:', error);
    // Stale beats nothing; empty makes rollBuild return null rather than
    // inventing a build out of ids it never checked.
    return cache?.items ?? [];
  }
}

/** Id to item, for printing or drawing a stored build. */
export async function itemIndex(): Promise<Map<number, ItemInfo>> {
  return new Map((await buildableItems()).map((item) => [item.id, item]));
}
