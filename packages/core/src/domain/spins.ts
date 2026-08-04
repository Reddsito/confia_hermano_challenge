/**
 * What a blue shell can roll: a champion, or a whole rune page.
 *
 * Pure like the shell rules next door. Everything random enters through an
 * injected `rng`, so a spin can be replayed exactly in a test instead of being
 * asserted at "well, it returned something".
 */

/** Returns a float in [0, 1). Injected so spins are reproducible under test. */
export type Rng = () => number;

const defaultRng: Rng = Math.random;

export function pick<T>(pool: readonly T[], rng: Rng = defaultRng): T | null {
  if (pool.length === 0) return null;
  return pool[Math.floor(rng() * pool.length)] ?? pool[pool.length - 1]!;
}

/**
 * Every spin is uniform: a champion the player barely touched is exactly as
 * likely as their one-trick. Weighting by mastery was considered and dropped —
 * biasing toward low mastery makes the punishment harsher but also makes it
 * predictable, and the whole appeal is that anything in the pool can land.
 */
export function rollChampion(
  pool: readonly number[],
  rng: Rng = defaultRng,
): number | null {
  return pick(pool, rng);
}

/** How many times a thrower may re-spin a champion the target says they lack. */
export const MAX_CHAMPION_REROLLS = 2;

// ---------------------------------------------------------------------------
// Builds
// ---------------------------------------------------------------------------

/** A full inventory: six slots, trinket aside. */
export const BUILD_SIZE = 6;

export interface BuildItem {
  id: number;
  isBoots: boolean;
}

/**
 * Six distinct items, at most one pair of boots.
 *
 * The boots cap is the only rule bent here, and it is not taste: you cannot
 * wear two pairs, so a roll with three of them would be a punishment nobody
 * could carry out. Everything else stays uniform — a full-tank build on an ADC
 * is exactly the sort of thing this is for.
 *
 * Returns null when the pool cannot fill six slots, which only happens if the
 * item list failed to load.
 */
export function rollBuild(
  pool: readonly BuildItem[],
  rng: Rng = defaultRng,
): number[] | null {
  if (pool.length < BUILD_SIZE) return null;

  const remaining = [...pool];
  const chosen: number[] = [];
  let hasBoots = false;

  while (chosen.length < BUILD_SIZE && remaining.length > 0) {
    const index = Math.floor(rng() * remaining.length);
    const [item] = remaining.splice(index, 1);
    if (!item) break;

    // Drawn without replacement, so a rejected pair of boots is gone rather
    // than able to come up again and stall the loop.
    if (item.isBoots && hasBoots) continue;
    if (item.isBoots) hasBoots = true;

    chosen.push(item.id);
  }

  return chosen.length === BUILD_SIZE ? chosen : null;
}

// ---------------------------------------------------------------------------
// Runes
// ---------------------------------------------------------------------------

export interface RuneOption {
  id: number;
  name: string;
  icon: string;
}

export interface RuneSlot {
  runes: RuneOption[];
}

export interface RuneTree {
  id: number;
  name: string;
  icon: string;
  /** Slot 0 holds the keystones; slots 1-3 hold the minor runes. */
  slots: RuneSlot[];
}

export interface RunePage {
  primaryStyle: number;
  /** Keystone first, then one minor rune per slot, in slot order. */
  primary: number[];
  secondaryStyle: number;
  /** Two runes, taken from two different minor slots of the secondary tree. */
  secondary: number[];
  /** Offense, flex and defense shards, in that order. */
  shards: number[];
}

/**
 * The stat shards, which `runesReforged.json` does not carry — Data Dragon
 * describes the three trees only, so the three shard rows are spelled out here.
 * Ids are stable across patches; the rows are what Riot shows bottom-right of
 * the rune editor, in order.
 */
export const STAT_SHARD_ROWS: readonly (readonly number[])[] = [
  [5008, 5005, 5007], // Adaptive Force, Attack Speed, Ability Haste
  [5008, 5010, 5001], // Adaptive Force, Move Speed, Health Scaling
  [5011, 5013, 5001], // Health, Tenacity & Slow Resist, Health Scaling
];

/**
 * Rolls a legal, complete rune page.
 *
 * "Legal" is the whole point: the client refuses a page that breaks any of
 * these, so generating one that cannot be typed in would make the punishment
 * impossible rather than hard.
 *
 * - the secondary tree is never the primary one
 * - the two secondary runes come from two *different* slots
 * - exactly one shard per row
 *
 * Returns null when fewer than two trees are available, which only happens if
 * the Data Dragon fetch failed — better a missing roll than an illegal page.
 */
export function rollRunePage(
  trees: readonly RuneTree[],
  rng: Rng = defaultRng,
): RunePage | null {
  const usable = trees.filter((tree) => tree.slots.length >= 4);
  if (usable.length < 2) return null;

  const primaryTree = pick(usable, rng)!;
  const secondaryTree = pick(
    usable.filter((tree) => tree.id !== primaryTree.id),
    rng,
  )!;

  const primary: number[] = [];
  for (const slot of primaryTree.slots.slice(0, 4)) {
    const rune = pick(slot.runes, rng);
    if (!rune) return null;
    primary.push(rune.id);
  }

  // Two distinct minor slots, chosen by dropping one at random rather than by
  // picking two indexes and retrying on a collision.
  const minorSlots = secondaryTree.slots.slice(1, 4);
  if (minorSlots.length < 3) return null;
  const dropped = Math.floor(rng() * minorSlots.length);

  const secondary: number[] = [];
  minorSlots.forEach((slot, index) => {
    if (index === dropped) return;
    const rune = pick(slot.runes, rng);
    if (rune) secondary.push(rune.id);
  });
  if (secondary.length !== 2) return null;

  const shards = STAT_SHARD_ROWS.map((row) => pick(row, rng)!);

  return {
    primaryStyle: primaryTree.id,
    primary,
    secondaryStyle: secondaryTree.id,
    secondary,
    shards,
  };
}
