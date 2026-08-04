/**
 * Turning a challenge into a concrete result.
 *
 * A TEXT challenge is already its own punishment, so it rolls nothing. The
 * other kinds have to be resolved at throw time against the person who was hit,
 * which is why this needs the database and a Riot client rather than living in
 * the pure domain next to the dice.
 */
import { rollChampion, rollRunePage } from '@challenge/core/domain';
import { RiotClient } from '@challenge/core/riot';

import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import { masteryIsStale, masteryPool, saveMastery } from '../db/mastery';
import { getPlayerState } from '../db/players';
import type { ChallengeKind, ShellPayload } from '../db/shells';
import { runeTrees } from '../riot/runes';

/**
 * The champions a player can be sentenced to.
 *
 * Refreshed from Riot only when the cache is stale or empty, so firing ten
 * shells at the same person costs one mastery call, not ten.
 */
export async function championPoolFor(
  db: Db,
  config: ServerConfig,
  playerId: string,
): Promise<number[]> {
  const cached = masteryPool(db, playerId);
  if (!masteryIsStale(cached)) return cached.championIds;

  const state = getPlayerState(db, playerId);
  if (!state?.puuid || !config.riotApiKey) return cached.championIds;

  try {
    const client = new RiotClient(config.riotApiKey, config.platform);
    saveMastery(db, playerId, await client.getChampionMastery(state.puuid));
    return masteryPool(db, playerId).championIds;
  } catch (error) {
    console.warn('[spin] could not refresh mastery:', error);
    // A stale pool still spins. Failing the throw over this would let a Riot
    // outage eat someone's shell.
    return cached.championIds;
  }
}

/**
 * What this challenge produces for this target, or null when it produces
 * nothing — either because it is a plain TEXT challenge, or because the data it
 * needed could not be loaded.
 */
export async function rollFor(
  db: Db,
  config: ServerConfig,
  kind: ChallengeKind,
  targetId: string,
): Promise<ShellPayload | null> {
  if (kind === 'RANDOM_CHAMPION') {
    const pool = await championPoolFor(db, config, targetId);
    const championId = rollChampion(pool);
    return championId === null ? null : { kind: 'RANDOM_CHAMPION', championId };
  }

  if (kind === 'RANDOM_RUNES') {
    const page = rollRunePage(await runeTrees());
    return page === null ? null : { kind: 'RANDOM_RUNES', page };
  }

  return null;
}
