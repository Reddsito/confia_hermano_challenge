/**
 * Champion id to name, from Data Dragon.
 *
 * Data Dragon needs no API key and is a static CDN, so this costs nothing
 * against the Riot rate limit. The result is cached for a day: champion names
 * only change when a new one ships.
 */
const VERSIONS_URL = 'https://ddragon.leagueoflegends.com/api/versions.json';
const CACHE_MS = 24 * 60 * 60 * 1000;

let cache: { names: Map<number, string>; fetchedAt: number } | null = null;
let inFlight: Promise<Map<number, string>> | null = null;

async function load(): Promise<Map<number, string>> {
  const versions = (await (await fetch(VERSIONS_URL)).json()) as string[];
  const latest = versions[0];
  if (!latest) throw new Error('Data Dragon returned no versions');

  const payload = (await (
    await fetch(
      `https://ddragon.leagueoflegends.com/cdn/${latest}/data/en_US/champion.json`,
    )
  ).json()) as { data: Record<string, { key: string; name: string }> };

  const names = new Map<number, string>();
  for (const champion of Object.values(payload.data)) {
    names.set(Number(champion.key), champion.name);
  }
  return names;
}

export async function championNames(): Promise<Map<number, string>> {
  if (cache && Date.now() - cache.fetchedAt < CACHE_MS) return cache.names;

  // Concurrent callers share one request rather than each starting their own.
  inFlight ??= load()
    .then((names) => {
      cache = { names, fetchedAt: Date.now() };
      return names;
    })
    .finally(() => {
      inFlight = null;
    });

  try {
    return await inFlight;
  } catch (error) {
    console.warn('[champions] could not load names:', error);
    // A stale map beats no names at all; an empty one degrades to ids.
    return cache?.names ?? new Map();
  }
}

export async function championName(id: number): Promise<string> {
  const names = await championNames();
  return names.get(id) ?? `Champion ${id}`;
}
