import { API_URL } from './api';
import type { Wallet } from './bets';

export interface CoinWallet {
  coins: number;
  cap: number;
  isSpectator: boolean;
  /** Earned today from the daily grant and wins, against the daily cap. */
  earnedToday: number;
  dailyCap: number;
}

export interface CoinMovement {
  source: string;
  amount: number;
  day: string;
  detail: string;
  createdAt: number;
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

export interface CoinState {
  wallet: CoinWallet;
  shells: Wallet;
  ledger: CoinMovement[];
  shellPrice: number;
}

export async function fetchCoins(token: string): Promise<CoinState> {
  const response = await fetch(`${API_URL}/api/coins/me`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as CoinState;
}

export async function buyShell(
  token: string,
): Promise<{ wallet: CoinWallet; shells: Wallet }> {
  const response = await fetch(`${API_URL}/api/coins/shop/shell`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as { wallet: CoinWallet; shells: Wallet };
}
