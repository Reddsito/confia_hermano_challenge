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
          ? 'That code is not right.'
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

