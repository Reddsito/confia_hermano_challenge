import type { BetMarket } from '@challenge/core/domain';

import { API_URL } from './api';

export interface Wallet {
  available: number;
  ceiling: number;
  /** How many shells are owed. Zero unless the balance went negative. */
  debt: number;
  isSpectator: boolean;
}

export interface OpenBet {
  id: string;
  playerId: string;
  gameId: string;
  market: BetMarket;
  selection: string;
  stake: number;
  placedAt: number;
}

export interface LiveWager {
  id: string;
  gameId: string;
  /** Whose game it is on. */
  playerId: string;
  onName: string;
  /** Who placed it, so your own wagers can be highlighted. */
  discordId: string;
  bettorName: string;
  isSpectator: boolean;
  market: BetMarket;
  selection: string;
  stake: number;
  placedAt: number;
}

export async function fetchLiveWagers(): Promise<LiveWager[]> {
  const response = await fetch(`${API_URL}/api/bets/live`);
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { wagers: LiveWager[] }).wagers;
}

export interface BetStanding {
  discordId: string;
  displayName: string;
  playerId: string | null;
  isSpectator: boolean;
  bets: number;
  won: number;
  lost: number;
  net: number;
}

function authHeaders(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? `Error ${response.status}`;
}

export async function fetchStandings(): Promise<BetStanding[]> {
  const response = await fetch(`${API_URL}/api/bets/standings`);
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { standings: BetStanding[] }).standings;
}

export async function fetchMyBets(
  token: string,
): Promise<{ balance: Wallet; open: OpenBet[]; maxStake: number }> {
  const response = await fetch(`${API_URL}/api/bets/me`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as {
    balance: Wallet;
    open: OpenBet[];
    maxStake: number;
  };
}

export async function placeBet(
  token: string,
  bet: {
    playerId: string;
    market: BetMarket;
    selection: string;
    stake: number;
  },
): Promise<Wallet> {
  const response = await fetch(`${API_URL}/api/bets`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify(bet),
  });
  if (!response.ok) throw new Error(await readError(response));
  return ((await response.json()) as { balance: Wallet }).balance;
}
