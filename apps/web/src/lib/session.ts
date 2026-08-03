import { API_URL } from './api';

export interface SessionUser {
  discordId: string;
  username: string;
  avatar: string | null;
  playerId: string | null;
  isAdmin: boolean;
  shells: { earned: number; thrown: number; available: number } | null;
}

const STORAGE_KEY = 'challenge.session';

export function avatarUrl(user: SessionUser): string | null {
  if (!user.avatar) return null;
  return `https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=64`;
}

export function loginUrl(): string {
  return `${API_URL}/api/auth/discord`;
}

/**
 * The backend sends the session back in the URL fragment. Reading it here and
 * immediately rewriting the URL keeps the token out of the address bar, out of
 * the history entry, and out of anything the user might paste to a friend.
 */
export function captureSessionFromUrl(): string | null {
  if (typeof window === 'undefined') return null;

  const hash = window.location.hash.replace(/^#/, '');
  if (!hash) return null;

  const params = new URLSearchParams(hash);
  const token = params.get('session');
  if (!token) return null;

  localStorage.setItem(STORAGE_KEY, token);
  history.replaceState(null, '', window.location.pathname + window.location.search);
  return token;
}

export function readToken(): string | null {
  if (typeof localStorage === 'undefined') return null;
  return localStorage.getItem(STORAGE_KEY);
}

export function signOut(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export async function fetchMe(token: string): Promise<SessionUser | null> {
  const response = await fetch(`${API_URL}/api/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });

  // An expired or tampered token is indistinguishable from no token at all,
  // so the stored value is cleared rather than left to fail on every call.
  if (response.status === 401) {
    signOut();
    return null;
  }
  if (!response.ok) return null;

  return (await response.json()) as SessionUser;
}

export interface ChallengeOdds {
  id: string;
  name: string;
  detail: string;
  weight: number;
  chance: number;
}

export async function fetchChallenges(): Promise<ChallengeOdds[]> {
  const response = await fetch(`${API_URL}/api/shells/challenges`);
  if (!response.ok) return [];
  return ((await response.json()) as { challenges: ChallengeOdds[] }).challenges;
}

export interface ShellsState {
  max: number;
  players: Array<{
    playerId: string;
    earned: number;
    thrown: number;
    available: number;
    shells: Array<{
      id: string;
      rule: string;
      amount: number;
      detail: string;
      earnedAt: number;
    }>;
  }>;
  throws: Array<{
    id: string;
    fromPlayer: string | null;
    toPlayer: string;
    challengeName: string;
    thrownAt: number;
    completedAt: number | null;
  }>;
}

export async function fetchShells(): Promise<ShellsState | null> {
  const response = await fetch(`${API_URL}/api/shells`);
  if (!response.ok) return null;
  return (await response.json()) as ShellsState;
}

export interface ThrowResult {
  challenge: { id: string; name: string; detail: string };
  remaining: number;
}

export async function throwShell(
  token: string,
  targetId: string,
): Promise<ThrowResult> {
  const response = await fetch(`${API_URL}/api/shells/throw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ targetId }),
  });

  const body = (await response.json()) as ThrowResult & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'No se pudo tirar la concha.');
  return body;
}
