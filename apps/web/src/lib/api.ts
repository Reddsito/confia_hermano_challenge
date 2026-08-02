import type { Snapshot } from '@challenge/core/domain';

/**
 * Base URL of the challenge backend. Set PUBLIC_API_URL at build time; it is
 * public on purpose, since the browser has to call it directly. Nothing secret
 * ever reaches this side — the Riot key lives only on the server.
 */
export const API_URL = (
  import.meta.env.PUBLIC_API_URL ?? 'http://localhost:8787'
).replace(/\/$/, '');

export const SNAPSHOT_ENDPOINT = `${API_URL}/api/snapshot`;
export const SIGNUP_ENDPOINT = `${API_URL}/api/signup`;

/**
 * Shown when the backend cannot be reached during the build. The page still
 * renders its shell and the client island retries on load, so a backend that is
 * briefly down never produces a broken deploy.
 */
export function emptySnapshot(): Snapshot {
  const now = new Date();
  return {
    version: 1,
    generatedAt: now.toISOString(),
    nextUpdateAt: new Date(now.getTime() + 120_000).toISOString(),
    source: 'riot',
    tournament: {
      name: 'Confia Hermano Challenge',
      edition: '',
      subtitle: '',
      platform: 'euw1',
      queue: 'RANKED_SOLO_5x5',
      startsAt: now.toISOString(),
      endsAt: now.toISOString(),
      refreshIntervalMinutes: 2,
    },
    players: [],
  };
}

/** Build-time fetch. Never throws — a missing backend must not fail the build. */
export async function loadSnapshotAtBuild(): Promise<Snapshot> {
  try {
    const response = await fetch(SNAPSHOT_ENDPOINT, {
      signal: AbortSignal.timeout(5000),
    });
    if (!response.ok) throw new Error(String(response.status));
    return (await response.json()) as Snapshot;
  } catch (error) {
    console.warn(
      `[build] Could not reach ${SNAPSHOT_ENDPOINT} (${error instanceof Error ? error.message : error}).`,
      'Rendering an empty shell; the client will fetch on load.',
    );
    return emptySnapshot();
  }
}
