import { RiotApiError, RiotClient } from '@challenge/core/riot';

import type { ServerConfig } from '../config';

/**
 * `ok` is a literal discriminant so TypeScript narrows the union at the call
 * site; a `null | string` field does not narrow.
 */
export type VerifiedRiotId =
  | { ok: true; gameName: string; tagLine: string; puuid: string | null }
  | { ok: false; error: string; status: 404 | 502 };

/**
 * Resolves a Riot ID so a typo is rejected while the person is still looking at
 * the form, instead of becoming an empty row on the leaderboard days later.
 *
 * Shared by the admin panel and public signup: both put a name on the roster,
 * and a signup that accepted IDs the panel would reject would just move the
 * failure to whoever approves it. In mock mode there is no key to check
 * against, so the input is taken as typed.
 */
export async function verifyRiotId(
  config: ServerConfig,
  gameName: string,
  tagLine: string,
): Promise<VerifiedRiotId> {
  if (config.useMockData) {
    return { ok: true, gameName, tagLine, puuid: null };
  }

  try {
    const client = new RiotClient(config.riotApiKey, config.platform);
    const account = await client.getAccountByRiotId(gameName, tagLine);
    return {
      ok: true,
      gameName: account.gameName,
      tagLine: account.tagLine,
      puuid: account.puuid,
    };
  } catch (error) {
    // Logged in full so the terminal shows the real cause; the browser gets a
    // message that says what to actually do about it.
    console.error('[riot] lookup failed:', error);

    if (error instanceof RiotApiError) {
      if (error.status === 404) {
        return {
          ok: false,
          error: `No se encontró la cuenta ${gameName}#${tagLine} en ${config.platform}. Revisá el nombre y el tag — el tag es lo que va después del # en el cliente.`,
          status: 404,
        };
      }
      if (error.status === 401 || error.status === 403) {
        return {
          ok: false,
          error:
            'Riot rechazó la API key. Una key de desarrollo vence cada 24 horas — generá una nueva en developer.riotgames.com y reiniciá el servidor.',
          status: 502,
        };
      }
      if (error.status === 429) {
        return {
          ok: false,
          error: 'Se alcanzó el límite de peticiones. Esperá un minuto y probá de nuevo.',
          status: 502,
        };
      }
      return {
        ok: false,
        error: `Riot respondió ${error.status}. Revisá los logs del servidor.`,
        status: 502,
      };
    }

    return {
      ok: false,
      error: 'No se pudo contactar a Riot. Revisá los logs y tu conexión.',
      status: 502,
    };
  }
}
