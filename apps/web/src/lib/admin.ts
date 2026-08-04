import type { Role } from '@challenge/core/domain';

import { API_URL } from './api';

export interface RosterPlayer {
  id: string;
  displayName: string;
  gameName: string;
  tagLine: string;
  role: Role;
  status: 'pending' | 'approved' | 'rejected';
  puuid: string | null;
  createdAt: string;
}

export interface PanelInfo {
  platform: string;
  tournament: string;
  source: 'mock' | 'riot';
}

/**
 * The shared code is kept in localStorage, not in a cookie: it is only ever
 * sent to our own API as a bearer token, and there is no session to forge.
 * Anyone holding it can edit the roster, which is the intended model — it is a
 * group password, not a user account.
 */
const STORAGE_KEY = 'challenge.panel.code';

export function readCode(): string {
  if (typeof localStorage === 'undefined') return '';
  return localStorage.getItem(STORAGE_KEY) ?? '';
}

export function storeCode(code: string): void {
  localStorage.setItem(STORAGE_KEY, code);
}

export function clearCode(): void {
  localStorage.removeItem(STORAGE_KEY);
}

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

async function request<T>(
  code: string,
  path: string,
  init: RequestInit = {},
): Promise<T> {
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${code}`,
      ...init.headers,
    },
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as {
      error?: string;
    };
    throw new ApiError(
      response.status,
      body.error ??
        (response.status === 401
          ? 'Ese código no es correcto.'
          : `Request failed (${response.status}).`),
    );
  }

  return (await response.json()) as T;
}

export function fetchInfo(): Promise<PanelInfo> {
  return fetch(`${API_URL}/api/health`).then((response) => {
    if (!response.ok) throw new ApiError(response.status, 'Backend unreachable.');
    return response.json() as Promise<PanelInfo>;
  });
}

export function fetchRoster(code: string): Promise<RosterPlayer[]> {
  return request<{ players: RosterPlayer[] }>(code, '/api/admin/players').then(
    (body) => body.players,
  );
}

export function addPlayer(
  code: string,
  input: { displayName: string; gameName: string; tagLine: string; role: Role },
): Promise<{ player: RosterPlayer }> {
  return request(code, '/api/admin/players', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function editPlayer(
  code: string,
  id: string,
  input: Partial<Pick<RosterPlayer, 'displayName' | 'gameName' | 'tagLine' | 'role'>>,
): Promise<{ player: RosterPlayer; statsReset: boolean }> {
  return request(code, `/api/admin/players/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function setVisible(
  code: string,
  id: string,
  visible: boolean,
): Promise<{ ok: true }> {
  return request(code, `/api/admin/players/${id}/${visible ? 'approve' : 'reject'}`, {
    method: 'POST',
  });
}

export function removePlayer(code: string, id: string): Promise<{ ok: true }> {
  return request(code, `/api/admin/players/${id}`, { method: 'DELETE' });
}


export interface DiscordUser {
  discordId: string;
  username: string;
  avatar: string | null;
  playerId: string | null;
  isAdmin: boolean;
  lastSeen: number;
}

export function fetchDiscordUsers(code: string): Promise<DiscordUser[]> {
  return request<{ users: DiscordUser[] }>(code, '/api/admin/discord-users').then(
    (body) => body.users,
  );
}

/** Passing null unlinks. The backend keeps the mapping one-to-one. */
export function linkDiscordUser(
  code: string,
  discordId: string,
  playerId: string | null,
): Promise<{ ok: true }> {
  return request(code, `/api/admin/discord-users/${discordId}/link`, {
    method: 'POST',
    body: JSON.stringify({ playerId }),
  });
}

export type ChallengeKind = 'TEXT' | 'RANDOM_CHAMPION' | 'RANDOM_RUNES';

export const CHALLENGE_KIND_LABEL: Record<ChallengeKind, string> = {
  TEXT: 'Texto',
  RANDOM_CHAMPION: 'Campeón aleatorio',
  RANDOM_RUNES: 'Runas aleatorias',
};

export interface AdminChallenge {
  id: string;
  name: string;
  detail: string;
  weight: number;
  enabled: boolean;
  kind: ChallengeKind;
}

export interface AdminThrow {
  id: string;
  fromPlayer: string | null;
  fromName: string | null;
  toPlayer: string;
  toName: string | null;
  challengeName: string;
  thrownAt: number;
  completedAt: number | null;
}

export function fetchAdminThrows(code: string): Promise<AdminThrow[]> {
  return request<{ throws: AdminThrow[] }>(code, '/api/admin/throws').then(
    (body) => body.throws,
  );
}

/** Undoes a throw. The shell returns on its own — balances count these rows. */
export function removeThrow(code: string, id: string): Promise<unknown> {
  return request(code, `/api/admin/throws/${id}`, { method: 'DELETE' });
}

export function fetchAdminChallenges(code: string): Promise<AdminChallenge[]> {
  return request<{ challenges: AdminChallenge[] }>(code, '/api/admin/challenges').then(
    (body) => body.challenges,
  );
}

export function createChallenge(
  code: string,
  input: { name: string; detail?: string; weight?: number; kind?: ChallengeKind },
): Promise<unknown> {
  return request(code, '/api/admin/challenges', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function patchChallenge(
  code: string,
  id: string,
  input: Partial<AdminChallenge>,
): Promise<unknown> {
  return request(code, `/api/admin/challenges/${id}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  });
}

export function removeChallenge(code: string, id: string): Promise<unknown> {
  return request(code, `/api/admin/challenges/${id}`, { method: 'DELETE' });
}

export function adjustShells(
  code: string,
  playerId: string,
  amount: number,
  reason: string,
): Promise<{ available: number }> {
  return request(code, `/api/admin/players/${playerId}/shells`, {
    method: 'POST',
    body: JSON.stringify({ amount, reason }),
  });
}
