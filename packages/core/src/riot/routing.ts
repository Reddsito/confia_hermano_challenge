/**
 * Riot uses two different routing schemes and mixing them is the single most
 * common integration bug. Platform routing (euw1, na1, ...) serves per-server
 * data such as league standings; regional routing (europe, americas, ...)
 * serves account-wide data such as Riot IDs and match history.
 */
export type PlatformId =
  | 'br1'
  | 'eun1'
  | 'euw1'
  | 'jp1'
  | 'kr'
  | 'la1'
  | 'la2'
  | 'me1'
  | 'na1'
  | 'oc1'
  | 'ph2'
  | 'ru'
  | 'sg2'
  | 'th2'
  | 'tr1'
  | 'tw2'
  | 'vn2';

export type RegionalRoute = 'americas' | 'europe' | 'asia' | 'sea';

const REGIONAL_ROUTE_BY_PLATFORM: Record<PlatformId, RegionalRoute> = {
  br1: 'americas',
  la1: 'americas',
  la2: 'americas',
  na1: 'americas',
  eun1: 'europe',
  euw1: 'europe',
  me1: 'europe',
  ru: 'europe',
  tr1: 'europe',
  jp1: 'asia',
  kr: 'asia',
  tw2: 'asia',
  oc1: 'sea',
  ph2: 'sea',
  sg2: 'sea',
  th2: 'sea',
  vn2: 'sea',
};

export function isPlatformId(value: string): value is PlatformId {
  return value in REGIONAL_ROUTE_BY_PLATFORM;
}

export function regionalRouteFor(platform: PlatformId): RegionalRoute {
  return REGIONAL_ROUTE_BY_PLATFORM[platform];
}

export function platformHost(platform: PlatformId): string {
  return `https://${platform}.api.riotgames.com`;
}

export function regionalHost(route: RegionalRoute): string {
  return `https://${route}.api.riotgames.com`;
}
