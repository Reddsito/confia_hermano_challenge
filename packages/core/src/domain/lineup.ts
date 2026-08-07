/**
 * Putting a live team in lane order.
 *
 * Riot's spectator endpoint does not report a position. It returns participants
 * in pick order, which lands on top-jungle-mid-adc-support often enough to look
 * deliberate and then scrambles without warning — which is exactly why the live
 * table reads as broken "sometimes" rather than always.
 *
 * So the order is reconstructed from what we actually know, and this module is
 * deliberately honest about how little that is:
 *
 *   - A tracked player's role comes from the roster. This is a fact.
 *   - Smite means jungle. Close enough to a fact to use.
 *   - Everybody else is unknown, and no amount of cleverness on a champion id
 *     will change that.
 *
 * Rather than sort by a mostly-unknown key — which would herd the two knowns to
 * the front and leave the rest in Riot's order, looking no better than before —
 * known players are seated in their own lane and the unknowns fill the empty
 * seats in the order Riot gave them. The result is five slots that always read
 * in lane order, correct wherever we had evidence and stable wherever we did
 * not.
 */

import { ROLES, type Role } from './types';

export interface LineupSlot {
  /** The roster role, when this participant is a tracked player. */
  role?: Role | null;
  /** Whether this participant is carrying Smite. */
  hasSmite?: boolean;
}

/**
 * Best guess at one participant's lane, or null when there is no evidence.
 *
 * The roster wins over Smite on purpose: a registered mid who picks up Smite
 * for a game is still the mid we know, and pretending otherwise would move a
 * name the viewer recognises into the wrong row.
 */
export function laneOf(slot: LineupSlot): Role | null {
  if (slot.role) return slot.role;
  if (slot.hasSmite) return 'JUNGLE';
  return null;
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
  const unseated: T[] = [];

  for (const member of team) {
    const lane = laneOf(member);
    // Two claims on one lane means the evidence disagrees with itself — a
    // tracked jungler against somebody else's Smite. First claim keeps the
    // seat and the loser is treated as unknown, which puts them in a free lane
    // instead of dropping them.
    if (lane && !seats.has(lane)) {
      seats.set(lane, member);
    } else {
      unseated.push(member);
    }
  }

  const ordered: T[] = [];
  const leftovers = [...unseated];

  for (const role of ROLES) {
    const seated = seats.get(role);
    if (seated) {
      ordered.push(seated);
    } else {
      const filler = leftovers.shift();
      if (filler) ordered.push(filler);
    }
  }

  // Anything past the five lanes — an oversized team we do not model — keeps
  // Riot's order at the end rather than vanishing.
  return [...ordered, ...leftovers];
}
