import { RateLimiter, sleep } from './rate-limiter';
import {
  platformHost,
  regionalHost,
  regionalRouteFor,
  type PlatformId,
} from './routing';

export class RiotApiError extends Error {
  constructor(
    readonly status: number,
    readonly url: string,
    message: string,
  ) {
    super(message);
    this.name = 'RiotApiError';
  }
}

export interface AccountDto {
  puuid: string;
  gameName: string;
  tagLine: string;
}

export interface SummonerDto {
  puuid: string;
  profileIconId: number;
  summonerLevel: number;
  revisionDate: number;
}

export interface LeagueEntryDto {
  queueType: string;
  tier: string;
  rank: string;
  leaguePoints: number;
  wins: number;
  losses: number;
  hotStreak: boolean;
}

export interface MatchParticipantDto {
  puuid: string;
  championId: number;
  championName: string;
  teamId: number;
  kills: number;
  deaths: number;
  assists: number;
  win: boolean;
  totalMinionsKilled: number;
  neutralMinionsKilled: number;
  teamPosition: string;
  summoner1Id: number;
  summoner2Id: number;
  goldEarned: number;
  totalDamageDealtToChampions: number;
  totalDamageTaken: number;
  visionScore: number;
  totalTimeSpentDead: number;
  pentaKills: number;
  quadraKills: number;
  tripleKills: number;
  largestKillingSpree: number;
  firstBloodKill: boolean;
  gameEndedInSurrender: boolean;
  /** Riot's own derived metrics. Absent on very old matches. */
  challenges?: {
    killParticipation?: number;
    soloKills?: number;
    damagePerMinute?: number;
    goldPerMinute?: number;
    visionScorePerMinute?: number;
  };
}

export interface MatchDto {
  metadata: { matchId: string; participants: string[] };
  info: {
    gameCreation: number;
    gameDuration: number;
    gameEndTimestamp?: number;
    queueId: number;
    participants: MatchParticipantDto[];
  };
}

export interface ActiveGameParticipantDto {
  puuid: string;
  championId: number;
  teamId: number;
  /** Riot ID. `summonerName` is deprecated and now comes back empty. */
  riotId?: string;
  summonerName?: string;
}

export interface ActiveGameDto {
  gameId: number;
  gameQueueConfigId: number;
  gameLength: number;
  participants: ActiveGameParticipantDto[];
}

const MAX_RETRIES = 3;

export class RiotClient {
  private readonly limiter: RateLimiter;

  constructor(
    private readonly apiKey: string,
    private readonly platform: PlatformId,
    limiter?: RateLimiter,
  ) {
    if (!apiKey) {
      throw new Error('RIOT_API_KEY is missing. Copy env.example to .env.');
    }
    this.limiter = limiter ?? new RateLimiter();
  }

  private get regionalBase(): string {
    return regionalHost(regionalRouteFor(this.platform));
  }

  private get platformBase(): string {
    return platformHost(this.platform);
  }

  private async request<T>(url: string): Promise<T> {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
      await this.limiter.acquire();

      const response = await fetch(url, {
        headers: { 'X-Riot-Token': this.apiKey },
      });

      if (response.ok) {
        return (await response.json()) as T;
      }

      if (response.status === 429) {
        const retryAfter = Number(response.headers.get('Retry-After') ?? '5');
        this.limiter.penalise(retryAfter);
        continue;
      }

      // 5xx is usually transient on Riot's side; back off and try again.
      if (response.status >= 500 && attempt < MAX_RETRIES) {
        await sleep(2 ** attempt * 500);
        continue;
      }

      throw new RiotApiError(
        response.status,
        url,
        `Riot API responded ${response.status} for ${redact(url)}`,
      );
    }

    throw new RiotApiError(429, url, `Gave up after ${MAX_RETRIES} retries`);
  }

  /** ACCOUNT-V1 — regional routing. The only way in, since Riot IDs replaced summoner names. */
  getAccountByRiotId(gameName: string, tagLine: string): Promise<AccountDto> {
    const path = `${encodeURIComponent(gameName)}/${encodeURIComponent(tagLine)}`;
    return this.request<AccountDto>(
      `${this.regionalBase}/riot/account/v1/accounts/by-riot-id/${path}`,
    );
  }

  /** SUMMONER-V4 — platform routing. Only needed for the profile icon and level. */
  getSummonerByPuuid(puuid: string): Promise<SummonerDto> {
    return this.request<SummonerDto>(
      `${this.platformBase}/lol/summoner/v4/summoners/by-puuid/${puuid}`,
    );
  }

  /**
   * LEAGUE-V4 — platform routing.
   * The by-summoner variant was removed in June 2025; this is the PUUID one.
   */
  getLeagueEntriesByPuuid(puuid: string): Promise<LeagueEntryDto[]> {
    return this.request<LeagueEntryDto[]>(
      `${this.platformBase}/lol/league/v4/entries/by-puuid/${puuid}`,
    );
  }

  /** MATCH-V5 — regional routing. Times are unix seconds, not milliseconds. */
  getMatchIds(
    puuid: string,
    options: { startTime?: number; queue?: number; count?: number } = {},
  ): Promise<string[]> {
    const params = new URLSearchParams({
      count: String(options.count ?? 20),
    });
    if (options.startTime) params.set('startTime', String(options.startTime));
    if (options.queue) params.set('queue', String(options.queue));

    return this.request<string[]>(
      `${this.regionalBase}/lol/match/v5/matches/by-puuid/${puuid}/ids?${params}`,
    );
  }

  getMatch(matchId: string): Promise<MatchDto> {
    return this.request<MatchDto>(
      `${this.regionalBase}/lol/match/v5/matches/${matchId}`,
    );
  }

  /**
   * SPECTATOR-V5 — platform routing. A 404 simply means "not in a game", which
   * is the common case, so it comes back as null rather than as a throw.
   */
  async getActiveGame(puuid: string): Promise<ActiveGameDto | null> {
    try {
      return await this.request<ActiveGameDto>(
        `${this.platformBase}/lol/spectator/v5/active-games/by-summoner/${puuid}`,
      );
    } catch (error) {
      if (error instanceof RiotApiError && error.status === 404) return null;
      throw error;
    }
  }
}

function redact(url: string): string {
  return url.replace(/\/[A-Za-z0-9_-]{60,}/g, '/<puuid>');
}
