import {
  DIVISIONS,
  TIERS,
  type MatchTotals,
  type Rank,
  type RankedPlayer,
  type Snapshot,
  type Tier,
} from './types';

const POINTS_PER_DIVISION = 100;
const DIVISIONS_PER_TIER = 4;
const POINTS_PER_TIER = POINTS_PER_DIVISION * DIVISIONS_PER_TIER;

/** Master, Grandmaster and Challenger share one continuous LP pool. */
const APEX_TIERS: readonly Tier[] = ['MASTER', 'GRANDMASTER', 'CHALLENGER'];
const APEX_FLOOR = TIERS.indexOf('MASTER') * POINTS_PER_TIER;

export function isApex(tier: Tier): boolean {
  return APEX_TIERS.includes(tier);
}

/** Emerald and under, which is where the ranking draws its shame line. */
const LOW_ELO_CEILING = TIERS.indexOf('DIAMOND');

/**
 * Whether a rank sits at Emerald or below. Unranked counts as low elo: a player
 * with no rank has not climbed out of it, and leaving them above the divider
 * would read as an endorsement nobody earned.
 */
export function isLowElo(rank: Rank | null): boolean {
  if (!rank) return true;
  return TIERS.indexOf(rank.tier) < LOW_ELO_CEILING;
}

/**
 * Ladder points at the bottom of a tier, so a chart can draw the tier bands on
 * the same scale the ranking sorts by rather than re-deriving the arithmetic.
 */
export function tierFloor(tier: Tier): number {
  return TIERS.indexOf(tier) * POINTS_PER_TIER;
}

/**
 * The inverse of {@link toLadderPoints}: a ladder number back into the rank a
 * player would recognise.
 *
 * A ladder point total is an internal sorting device — nobody has ever been
 * "687". Anything shown to a person goes through here first.
 */
export function ladderPointsToRank(points: number): Rank {
  const clamped = Math.max(0, points);

  if (clamped >= APEX_FLOOR) {
    const lp = clamped - APEX_FLOOR;
    const tier: Tier =
      lp >= 1000 ? 'CHALLENGER' : lp >= 500 ? 'GRANDMASTER' : 'MASTER';
    return { tier, division: null, leaguePoints: Math.round(lp) };
  }

  const tierIndex = Math.min(
    Math.floor(clamped / POINTS_PER_TIER),
    TIERS.length - 1,
  );
  const withinTier = clamped - tierIndex * POINTS_PER_TIER;
  const divisionIndex = Math.min(
    Math.floor(withinTier / POINTS_PER_DIVISION),
    DIVISIONS_PER_TIER - 1,
  );

  return {
    tier: TIERS[tierIndex]!,
    division: DIVISIONS[divisionIndex]!,
    leaguePoints: Math.round(withinTier - divisionIndex * POINTS_PER_DIVISION),
  };
}

export const TIER_LABEL: Record<Tier, string> = {
  IRON: 'Hierro',
  BRONZE: 'Bronce',
  SILVER: 'Plata',
  GOLD: 'Oro',
  PLATINUM: 'Platino',
  EMERALD: 'Esmeralda',
  DIAMOND: 'Diamante',
  MASTER: 'Maestro',
  GRANDMASTER: 'Gran Maestro',
  CHALLENGER: 'Retador',
};

/** Divisions read as numbers in Spanish: "Oro 4", not "Oro IV". */
const DIVISION_LABEL: Record<string, string> = {
  IV: '4',
  III: '3',
  II: '2',
  I: '1',
};

/** Shorthand for axes, where there is no room for the LP. */
export function formatRankShort(rank: Rank | null): string {
  if (!rank) return '—';
  return `${TIER_LABEL[rank.tier]}${rank.division ? ` ${DIVISION_LABEL[rank.division]}` : ''}`;
}

/**
 * Collapses tier + division + LP into a single comparable number, so two
 * players in different tiers can be sorted against each other.
 */
export function toLadderPoints(rank: Rank | null): number {
  if (!rank) return 0;

  if (isApex(rank.tier)) {
    return APEX_FLOOR + rank.leaguePoints;
  }

  const tierIndex = TIERS.indexOf(rank.tier);
  if (tierIndex < 0) return 0;

  const divisionIndex = rank.division ? DIVISIONS.indexOf(rank.division) : 0;
  return (
    tierIndex * POINTS_PER_TIER +
    Math.max(divisionIndex, 0) * POINTS_PER_DIVISION +
    rank.leaguePoints
  );
}

export function formatRank(rank: Rank | null): string {
  if (!rank) return 'Sin clasificar';
  if (isApex(rank.tier)) {
    return `${TIER_LABEL[rank.tier]} ${rank.leaguePoints} pts`;
  }
  return `${TIER_LABEL[rank.tier]} ${DIVISION_LABEL[rank.division!]} · ${rank.leaguePoints} pts`;
}

export function titleCase(value: string): string {
  return value.charAt(0) + value.slice(1).toLowerCase();
}

export function winRate(totals: MatchTotals): number {
  if (totals.games === 0) return 0;
  return totals.wins / totals.games;
}

export function kda(totals: MatchTotals): number {
  const deaths = Math.max(totals.deaths, 1);
  return (totals.kills + totals.assists) / deaths;
}

export function csPerMinute(totals: MatchTotals): number {
  if (totals.minutesPlayed <= 0) return 0;
  return totals.creepScore / totals.minutesPlayed;
}

/**
 * Assists per game relative to kills per game. A cheap stand-in for kill
 * participation, which would require pulling every team's totals from MATCH-V5.
 */
export function killParticipationProxy(totals: MatchTotals): number {
  const engagements = totals.kills + totals.assists;
  if (totals.games === 0) return 0;
  return engagements / totals.games;
}

/** Region codes used by op.gg differ from Riot platform routing values. */
const OPGG_REGION_BY_PLATFORM: Record<string, string> = {
  br1: 'br',
  eun1: 'eune',
  euw1: 'euw',
  jp1: 'jp',
  kr: 'kr',
  la1: 'lan',
  la2: 'las',
  me1: 'me',
  na1: 'na',
  oc1: 'oce',
  ph2: 'ph',
  ru: 'ru',
  sg2: 'sg',
  th2: 'th',
  tr1: 'tr',
  tw2: 'tw',
  vn2: 'vn',
};

export function opggUrl(
  platform: string,
  gameName: string,
  tagLine: string,
): string {
  const region = OPGG_REGION_BY_PLATFORM[platform] ?? 'euw';
  const slug = encodeURIComponent(`${gameName}-${tagLine}`);
  return `https://op.gg/lol/summoners/${region}/${slug}`;
}

/**
 * Single entry point for the UI: sorts by ladder points, assigns positions,
 * and precomputes every derived stat so components stay dumb.
 */
export function buildRanking(snapshot: Snapshot): RankedPlayer[] {
  return [...snapshot.players]
    .map((player) => {
      const ladderPoints = toLadderPoints(player.rank);
      return {
        ...player,
        ladderPoints,
        ladderPointsGained: ladderPoints - toLadderPoints(player.startRank),
        winRate: winRate(player.totals),
        kda: kda(player.totals),
        csPerMinute: csPerMinute(player.totals),
        killParticipationProxy: killParticipationProxy(player.totals),
        opggUrl: opggUrl(
          snapshot.tournament.platform,
          player.gameName,
          player.tagLine,
        ),
        position: 0,
      };
    })
    .sort((a, b) => {
      if (b.ladderPoints !== a.ladderPoints) {
        return b.ladderPoints - a.ladderPoints;
      }
      return b.totals.wins - a.totals.wins;
    })
    .map((player, index) => ({ ...player, position: index + 1 }));
}
