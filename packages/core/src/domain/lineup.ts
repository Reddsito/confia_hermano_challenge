/**
 * Putting a live team in lane order.
 *
 * Riot's spectator endpoint does not report a position — MATCH-V5 hands back a
 * `teamPosition` once the game is over, but SPECTATOR-V5 gives champion, team,
 * spells and runes and nothing else. It returns participants in pick order,
 * which lands on top-jungle-mid-adc-support often enough to look deliberate and
 * then scrambles without warning, which is exactly why the live table reads as
 * broken "sometimes" rather than always.
 *
 * So the order is reconstructed from what we actually know, and this module is
 * deliberately honest about how little that is. Weakest to strongest:
 *
 *   - A tracked player's role comes from the roster. This is a fact.
 *   - Smite means jungle. Close enough to a fact to use.
 *   - Heal means bot lane carry. Wrong now and then, right most of the time.
 *   - Teleport leans top. The weakest of the four, since mids take it too.
 *
 * Rather than sort by a mostly-unknown key — which would herd the knowns to the
 * front and leave the rest in Riot's order, looking no better than before —
 * claimants are seated in their own lane and whoever is left fills the empty
 * seats in the order Riot gave them. The result is five slots that always read
 * in lane order, correct wherever the evidence was, and stable wherever it was
 * not.
 *
 * The evidence is passed in as plain booleans rather than spell ids: which id
 * means Smite is Riot's business, and this module only cares that somebody is
 * carrying it.
 */

import { ROLES, type Role } from './types';

export interface LineupSlot {
  /** The roster role, when this participant is a tracked player. */
  role?: Role | null;
  hasSmite?: boolean;
  hasHeal?: boolean;
  hasTeleport?: boolean;
}

/**
 * How much a claim is worth. Lower wins a contested lane, so a registered mid
 * who picks up Smite is still the mid we know — moving a name the viewer
 * recognises into the wrong row would be the worse mistake.
 */
const enum Strength {
  Roster = 0,
  Smite = 1,
  Heal = 2,
  Teleport = 3,
}

interface Claim {
  lane: Role;
  strength: Strength;
}

function claimOf(slot: LineupSlot): Claim | null {
  if (slot.role) return { lane: slot.role, strength: Strength.Roster };
  if (slot.hasSmite) return { lane: 'JUNGLE', strength: Strength.Smite };
  if (slot.hasHeal) return { lane: 'ADC', strength: Strength.Heal };
  if (slot.hasTeleport) return { lane: 'TOP', strength: Strength.Teleport };
  return null;
}

/** Best guess at one participant's lane, or null when there is no evidence. */
export function laneOf(slot: LineupSlot): Role | null {
  return claimOf(slot)?.lane ?? null;
}

/**
 * Reorders one team into lane order, returning the input items rearranged.
 *
 * Never drops or duplicates: every input comes out exactly once, whatever the
 * team's size. A team is five people in practice, but nothing here assumes it —
 * a short or oversized list from a queue we do not model still round-trips.
 */
export function orderByLane<T extends LineupSlot>(team: readonly T[]): T[] {
  const seats = new Map<Role, T>();
  const seated = new Set<number>();

  // Strongest evidence first, so who gets a contested lane is decided by how
  // well we know it rather than by where Riot happened to list them. Ties fall
  // back to Riot's order, which keeps the result stable between polls.
  const claims = team
    .map((member, index) => ({ member, index, claim: claimOf(member) }))
    .filter((entry): entry is typeof entry & { claim: Claim } => entry.claim !== null)
    .sort((a, b) => a.claim.strength - b.claim.strength || a.index - b.index);

  for (const entry of claims) {
    // A lane already taken means the evidence disagrees with itself. The weaker
    // claim is treated as unknown, which drops that player into a free lane
    // instead of dropping them from the lineup.
    if (seats.has(entry.claim.lane)) continue;
    seats.set(entry.claim.lane, entry.member);
    seated.add(entry.index);
  }

  // By index rather than by identity: the same object appearing twice in a
  // lobby would otherwise vanish from the result.
  const leftovers = team.filter((_, index) => !seated.has(index));

  const ordered: T[] = [];
  for (const role of ROLES) {
    const member = seats.get(role);
    if (member) {
      ordered.push(member);
      continue;
    }
    const filler = leftovers.shift();
    if (filler) ordered.push(filler);
  }

  // Anything past the five lanes — an oversized team we do not model — keeps
  // Riot's order at the end rather than vanishing.
  return [...ordered, ...leftovers];
}
