import { API_URL } from './api';

export interface MatchRecord {
  matchId: string;
  playedAt: number;
  durationMinutes: number;
  win: boolean;
  championId: number;
  championName: string;
  kills: number;
  deaths: number;
  assists: number;
  creepScore: number;
  visionScore: number;
  goldEarned: number;
  damageToChampions: number;
  pentaKills: number;
  quadraKills: number;
  tripleKills: number;
  firstBlood: boolean;
  surrendered: boolean;
  killParticipation: number | null;
  /**
   * LP the game moved. Null when it could not be attributed to this game —
   * several games ingested in one sync cycle share a single rank sample, and
   * games recorded before this was tracked have none at all.
   */
  lpDelta: number | null;
}

export interface EarnedShellRecord {
  id: string;
  rule: string;
  amount: number;
  detail: string;
  earnedAt: number;
}

export interface ThrowRecord {
  id: string;
  challengeName: string;
  thrownAt: number;
  completedAt: number | null;
  /** Set on a throw this player fired. */
  toName?: string | null;
  /** Set on a throw this player took. Null when a spectator fired it. */
  fromName?: string | null;
}

export interface PlayerDetailData {
  matches: MatchRecord[];
  shells: {
    balance: { earned: number; thrown: number; available: number };
    earned: EarnedShellRecord[];
    thrown: ThrowRecord[];
    received: ThrowRecord[];
  };
}

export async function fetchPlayerDetail(
  playerId: string,
  signal?: AbortSignal,
): Promise<PlayerDetailData> {
  const response = await fetch(
    `${API_URL}/api/players/${encodeURIComponent(playerId)}/detail`,
    { signal },
  );

  if (!response.ok) {
    throw new Error('No pudimos traer la ficha de este jugador.');
  }

  return (await response.json()) as PlayerDetailData;
}
