export const ROLES = ['TOP', 'JUNGLE', 'MID', 'ADC', 'SUPPORT'] as const;
export type Role = (typeof ROLES)[number];

/** Ordered from lowest to highest. Index is used to compute ladder points. */
export const TIERS = [
  'IRON',
  'BRONZE',
  'SILVER',
  'GOLD',
  'PLATINUM',
  'EMERALD',
  'DIAMOND',
  'MASTER',
  'GRANDMASTER',
  'CHALLENGER',
] as const;
export type Tier = (typeof TIERS)[number];

export const DIVISIONS = ['IV', 'III', 'II', 'I'] as const;
export type Division = (typeof DIVISIONS)[number];

export interface Rank {
  tier: Tier;
  /** Apex tiers (Master and above) have no division. */
  division: Division | null;
  leaguePoints: number;
}

export interface MatchTotals {
  games: number;
  wins: number;
  losses: number;
  kills: number;
  deaths: number;
  assists: number;
  /** Minutes played across the counted games. */
  minutesPlayed: number;
  creepScore: number;
}

export interface ChampionUsage {
  championId: number;
  championName: string;
  games: number;
  wins: number;
}

/** One player as stored in the generated snapshot. */
export interface PlayerEntry {
  id: string;
  displayName: string;
  gameName: string;
  tagLine: string;
  role: Role;
  puuid: string | null;
  profileIconId: number | null;
  summonerLevel: number | null;
  rank: Rank | null;
  /** Rank at tournament start, used to compute LP gained. */
  startRank: Rank | null;
  totals: MatchTotals;
  topChampions: ChampionUsage[];
  /** Positive = win streak, negative = loss streak. */
  streak: number;
  /** Most recent results first; true = win. Drives the form sparkline. */
  recentResults: boolean[];
  /** Position in the previous snapshot, so the table can show movement. */
  previousPosition: number | null;
  inGame: boolean;
  /** Set when this player's data could not be refreshed. */
  error: string | null;
  /** Derived from the per-match table; absent until a cycle has stored games. */
  extras: PlayerExtras | null;
  /** Unspent blue shells this player is holding. */
  shells: number;
  /** The most recent challenge fired at them, for the hover card. */
  lastHit: LastHit | null;
  /** Challenges still owed, oldest first. One game settles one of them. */
  owes: string[];
}

export interface LastHit {
  challengeName: string;
  fromName: string | null;
  at: number;
}

export interface PlayerExtras {
  timeDeadSeconds: number;
  goldEarned: number;
  damageToChampions: number;
  damageTaken: number;
  visionScore: number;
  pentaKills: number;
  quadraKills: number;
  tripleKills: number;
  largestSpree: number;
  soloKills: number;
  firstBloods: number;
  surrenders: number;
  /** Riot's own figure, averaged over the counted games. 0-1. */
  killParticipation: number | null;
  bestKdaGame: number | null;
  /** Hour of day (UTC) this player queues most often. */
  favouriteHour: number | null;
  /** Longest run ever recorded, not the current one. */
  longestWinStreak: number;
  longestLossStreak: number;
}

/** Two tracked players who ended up in the same game. */
export interface HeadToHead {
  playerA: string;
  playerB: string;
  against: number;
  aWonAgainst: number;
  together: number;
  togetherWins: number;
}

export interface Duo {
  playerA: string;
  playerB: string;
  games: number;
  wins: number;
}

export interface DayDelta {
  playerId: string;
  day: string;
  delta: number;
}

export interface LpPoint {
  playerId: string;
  at: number;
  ladderPoints: number;
}

export interface TournamentMeta {
  name: string;
  edition: string;
  subtitle: string;
  platform: string;
  queue: string;
  startsAt: string;
  endsAt: string;
  refreshIntervalMinutes: number;
}

export interface Snapshot {
  /** Bumped when the snapshot shape changes, so stale clients can detect it. */
  version: number;
  generatedAt: string;
  nextUpdateAt: string;
  source: 'mock' | 'riot';
  tournament: TournamentMeta;
  players: PlayerEntry[];
  /** Group-wide sections that cannot be derived from a single player. */
  headToHead: HeadToHead[];
  duos: Duo[];
  dailyDeltas: DayDelta[];
  lpSeries: LpPoint[];
}

/** A player enriched with everything the UI needs, computed once. */
export interface RankedPlayer extends PlayerEntry {
  position: number;
  ladderPoints: number;
  ladderPointsGained: number;
  winRate: number;
  kda: number;
  killParticipationProxy: number;
  csPerMinute: number;
  opggUrl: string;
}
