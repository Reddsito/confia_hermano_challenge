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

export type ChallengeKind = 'TEXT' | 'RANDOM_CHAMPION' | 'RANDOM_RUNES';

export interface ChallengeOdds {
  id: string;
  name: string;
  detail: string;
  weight: number;
  kind: ChallengeKind;
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

export interface RunePage {
  primaryStyle: number;
  primary: number[];
  secondaryStyle: number;
  secondary: number[];
  shards: number[];
}

export type ShellPayload =
  | { kind: 'RANDOM_CHAMPION'; championId: number }
  | { kind: 'RANDOM_RUNES'; page: RunePage };

export interface ThrowResult {
  challenge: { id: string; name: string; detail: string; kind: ChallengeKind };
  throw: { id: string; payload: ShellPayload | null };
  rerollsLeft: number;
  remaining: number;
}

/**
 * `challengeId` names the challenge instead of spinning for it. Admin only and
 * rejected for everyone else, so a normal throw is always the wheel's call.
 */
export async function throwShell(
  token: string,
  targetId: string,
  challengeId?: string,
): Promise<ThrowResult> {
  const response = await fetch(`${API_URL}/api/shells/throw`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ targetId, challengeId }),
  });

  const body = (await response.json()) as ThrowResult & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'No se pudo tirar la concha.');
  return body;
}

/**
 * Rolls a result without storing anything. Admin only, and deliberately not
 * wired to a shell: it exists to check what a roll looks like, so it must not
 * cost one or leave anybody owing a game.
 */
export async function previewRoll(
  token: string,
  targetId: string,
  kind: 'RANDOM_CHAMPION' | 'RANDOM_RUNES',
): Promise<ShellPayload | null> {
  const response = await fetch(`${API_URL}/api/shells/preview`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ targetId, kind }),
  });

  const body = (await response.json()) as {
    payload: ShellPayload | null;
    error?: string;
  };
  if (!response.ok) throw new Error(body.error ?? 'No se pudo previsualizar.');
  return body.payload;
}

export interface RollRecord {
  id: string;
  payload: ShellPayload | null;
  reason: string;
  rolledAt: number;
}

export interface ReceivedThrow {
  id: string;
  fromPlayer: string | null;
  fromName: string | null;
  challengeName: string;
  thrownAt: number;
  completedAt: number | null;
  payload: ShellPayload | null;
  rolls: RollRecord[];
}

export async function fetchReceived(token: string): Promise<ReceivedThrow[]> {
  const response = await fetch(`${API_URL}/api/shells/received`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) return [];
  return ((await response.json()) as { throws: ReceivedThrow[] }).throws;
}

export interface RerollResult {
  championId: number;
  rerollsLeft: number;
  rolls: RollRecord[];
}

export async function rerollThrow(
  token: string,
  throwId: string,
  reason: string,
): Promise<RerollResult> {
  const response = await fetch(`${API_URL}/api/shells/throw/${throwId}/reroll`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ reason }),
  });

  const body = (await response.json()) as RerollResult & { error?: string };
  if (!response.ok) throw new Error(body.error ?? 'No se pudo volver a girar.');
  return body;
}

export interface Placement {
  playerId: string;
  tierKey: string;
  position: number;
  updatedBy: string | null;
  updatedAt: number;
}

export interface TierMove {
  id: string;
  playerId: string;
  playerName: string | null;
  fromTier: string | null;
  toTier: string | null;
  movedBy: string | null;
  movedByName: string | null;
  movedAt: number;
}

export interface TierBoard {
  placements: Placement[];
  moves: TierMove[];
}

export async function fetchTierBoard(): Promise<TierBoard> {
  const response = await fetch(`${API_URL}/api/tierlist`);
  if (!response.ok) return { placements: [], moves: [] };
  return (await response.json()) as TierBoard;
}

/** Moves a player, or takes them off the board when tierKey is null. */
export async function placeOnTier(
  token: string,
  playerId: string,
  tierKey: string | null,
): Promise<void> {
  const response = await fetch(`${API_URL}/api/tierlist/placements/${playerId}`, {
    method: 'PUT',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ tierKey }),
  });

  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? 'No se pudo mover.');
  }
}

export interface ChampionInfo {
  id: number;
  name: string;
  icon: string;
}

export async function fetchChampionIndex(): Promise<Map<number, ChampionInfo>> {
  const response = await fetch(`${API_URL}/api/shells/champions`);
  if (!response.ok) return new Map();

  const { champions } = (await response.json()) as { champions: ChampionInfo[] };
  return new Map(champions.map((champion) => [champion.id, champion]));
}

/** The champions a roll against this player could land on. */
export async function fetchChampionPool(playerId: string): Promise<number[]> {
  const response = await fetch(`${API_URL}/api/shells/pool/${playerId}`);
  if (!response.ok) return [];
  return ((await response.json()) as { championIds: number[] }).championIds;
}

export interface RuneOption {
  id: number;
  name: string;
  icon: string;
}

export interface RuneTree {
  id: number;
  name: string;
  icon: string;
  slots: Array<{ runes: RuneOption[] }>;
}

/**
 * Flat id-to-rune lookup, built once and shared. Rendering a stored page means
 * resolving nine ids, and walking the trees for each one would be nine nested
 * scans per page on screen.
 */
export async function fetchRuneIndex(): Promise<Map<number, RuneOption>> {
  const response = await fetch(`${API_URL}/api/shells/runes`);
  if (!response.ok) return new Map();

  const { trees } = (await response.json()) as { trees: RuneTree[] };
  const index = new Map<number, RuneOption>();

  for (const tree of trees) {
    index.set(tree.id, { id: tree.id, name: tree.name, icon: tree.icon });
    for (const slot of tree.slots) {
      for (const rune of slot.runes) index.set(rune.id, rune);
    }
  }

  return index;
}
