/**
 * Icon paths for summoner spells and rune styles, from Community Dragon.
 *
 * The file names cannot be derived from the id: Flash is "Summoner_flash",
 * Teleport is "Summoner_Teleport_New" and Ignite is "SummonerIgnite". Guessing
 * produces working URLs for some and 404s for the rest, so the index is read
 * and cached like the champion names next door. Community Dragon is a static
 * CDN with no key, so none of this counts against the Riot rate limit.
 */
const BASE =
  'https://raw.communitydragon.org/latest/plugins/rcp-be-lol-game-data/global/default';
const CACHE_MS = 24 * 60 * 60 * 1000;

/** Community Dragon reports asset paths rooted at /lol-game-data/assets. */
function assetUrl(iconPath: string): string {
  return `${BASE}${iconPath.replace('/lol-game-data/assets', '').toLowerCase()}`;
}

export interface GameAssets {
  /** Summoner spell id to icon URL. */
  spells: Map<number, string>;
  /** Rune style id (Precision, Domination, ...) to icon URL. */
  styles: Map<number, string>;
}

let cache: { assets: GameAssets; fetchedAt: number } | null = null;
let inFlight: Promise<GameAssets> | null = null;

async function load(): Promise<GameAssets> {
  const [spellPayload, stylePayload] = await Promise.all([
    fetch(`${BASE}/v1/summoner-spells.json`).then(
      (response) => response.json() as Promise<Array<{ id: number; iconPath: string }>>,
    ),
    fetch(`${BASE}/v1/perkstyles.json`).then(
      (response) =>
        response.json() as Promise<{
          styles: Array<{ id: number; iconPath: string }>;
        }>,
    ),
  ]);

  return {
    spells: new Map(
      spellPayload
        .filter((spell) => spell.iconPath)
        .map((spell) => [spell.id, assetUrl(spell.iconPath)]),
    ),
    styles: new Map(
      (stylePayload.styles ?? [])
        .filter((style) => style.iconPath)
        .map((style) => [style.id, assetUrl(style.iconPath)]),
    ),
  };
}

export async function gameAssets(): Promise<GameAssets> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.assets;

  inFlight ??= load()
    .then((assets) => {
      cache = { assets, fetchedAt: Date.now() };
      return assets;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch (error) {
    console.warn('[assets] could not load spell and rune icons:', error);
    // Stale beats nothing; empty means the UI simply omits the icon.
    return cache?.assets ?? { spells: new Map(), styles: new Map() };
  }
}
