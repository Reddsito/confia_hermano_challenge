import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { buildRanking } from '@challenge/core/domain';
import { ROLES, SPECTATOR_DAILY_GRANT, type Role, type Snapshot } from '@challenge/core/domain';
import { SNAPSHOT_ENDPOINT } from '../lib/api';
import {
  captureSessionFromUrl,
  fetchMe,
  loginUrl,
  readToken,
  signOut,
  avatarUrl,
  type SessionUser,
} from '../lib/session';
import { BlueShells, CoinMark, COIN_GOLD, ShellMark } from './BlueShells';
import { TierList } from './TierList';
import { LiveGames, useLiveFeed } from './LiveGames';
import { Filters, type FilterState, type SortKey } from './Filters';
import { PlayerDetail } from './PlayerDetail';
import { Podium } from './Podium';
import { RankingTable } from './RankingTable';
import { RefreshMeter } from './RefreshMeter';
import { NotifyButton } from './Notify';
import { RulesButton } from './Rules';
import { Clips } from './Clips';
import { DiscordLink, SignupButton } from './Signup';
import { BestDays, EloEvolution } from './EloCharts';
import { StatsPanel } from './StatsPanel';
import { Tabs, TabPanel } from './Tabs';
import { navigate, oneOf, setBasePath, useRoute } from '../lib/route';
import { TournamentClock, TournamentProgress } from './TournamentClock';

/**
 * How often we check whether the backend has published a newer snapshot.
 *
 * The check is free until the countdown runs out — it compares two numbers and
 * returns — so this is really the resolution of the moment that matters. At
 * fifteen seconds the page could sit on a finished refresh for fifteen seconds
 * before noticing, which the reader experiences as the wait the backend had
 * already finished.
 */
const POLL_CHECK_MS = 3_000;

export const SECTIONS = [
  'ranking',
  'live',
  'stats',
  'shells',
  'tierlist',
  'clips',
] as const;

type Section = (typeof SECTIONS)[number];

/** Lives at `/` rather than at a segment of its own; every other section is `/<id>`. */
export const HOME_SECTION: Section = 'ranking';

export function Dashboard({
  initialSnapshot,
  basePath = '',
}: {
  initialSnapshot: Snapshot;
  /**
   * Where this island is mounted. The production dashboard owns the root and
   * leaves it empty; `/demo` mounts the same island, with the same sections,
   * under its own prefix. Applied before the first `useRoute` read so the very
   * first render already knows which segment is the section.
   */
  basePath?: string;
}) {
  setBasePath(basePath);

  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [filters, setFilters] = useState<FilterState>({
    role: 'ALL',
    query: '',
    sort: 'ladder',
    reverse: false,
    liveOnly: false,
  });

  /** A new column starts best-first; the active one flips. */
  const sortBy = useCallback((key: SortKey) => {
    setFilters((current) =>
      current.sort === key
        ? { ...current, reverse: !current.reverse }
        : { ...current, sort: key, reverse: false },
    );
  }, []);

  // Bumped once per refresh cycle. The tabs that own their own data watch it and
  // refetch, so one heartbeat keeps the whole page current instead of each panel
  // showing whatever was true when you opened it.
  const [revision, setRevision] = useState(0);

  const route = useRoute();

  // Guards against overlapping fetches when a slow request meets the interval.
  const inFlight = useRef(false);

  const loadSession = useCallback(async () => {
    const stored = captureSessionFromUrl() ?? readToken();
    setToken(stored);
    setUser(stored ? await fetchMe(stored) : null);
  }, []);

  useEffect(() => {
    void loadSession();
  }, [loadSession]);

  const refresh = useCallback(async () => {
    if (inFlight.current) return;
    inFlight.current = true;
    setIsRefreshing(true);

    try {
      const response = await fetch(`${SNAPSHOT_ENDPOINT}?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) {
        throw new Error(`Snapshot request failed (${response.status})`);
      }
      setSnapshot((await response.json()) as Snapshot);
      setError(null);
    } catch (cause) {
      // Keep showing the last good snapshot rather than blanking the page.
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      setIsRefreshing(false);
    }
  }, []);

  /**
   * The whole page at once: the standings, your wallet, and every panel that
   * keeps its own data. Settled rather than raced so a failing session request
   * cannot hold back the rest.
   */
  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refresh(), loadSession()]);
    setRevision((value) => value + 1);
  }, [refresh, loadSession]);

  // The HTML was pre-rendered at build time, so whatever it carries is stale by
  // definition — and empty if the backend was down during the build. Fetch once
  // on mount rather than waiting for the first interval tick.
  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const dueAt = Date.parse(snapshot.nextUpdateAt);

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() >= dueAt) void refreshAll();
    };

    // Coming back to the tab refreshes unconditionally. The snapshot may still
    // be current, but your coins and the boards moved while you were away, and
    // that is exactly the moment people reach for reload.
    const onReturn = () => {
      if (document.visibilityState === 'visible') void refreshAll();
    };

    const id = setInterval(tick, POLL_CHECK_MS);
    document.addEventListener('visibilitychange', onReturn);
    return () => {
      clearInterval(id);
      document.removeEventListener('visibilitychange', onReturn);
    };
  }, [snapshot.nextUpdateAt, refreshAll]);

  // Held here rather than inside the live tab: TabPanel unmounts what is not
  // showing, and an alert that only fires while you are already looking at the
  // games is not an alert.
  const liveFeed = useLiveFeed();

  const ranking = useMemo(() => buildRanking(snapshot), [snapshot]);
  const liveCount = useMemo(
    () => ranking.filter((player) => player.inGame).length,
    [ranking],
  );

  const counts = useMemo(() => {
    const result = { ALL: ranking.length } as Record<Role | 'ALL', number>;
    for (const role of ROLES) {
      result[role] = ranking.filter((player) => player.role === role).length;
    }
    return result;
  }, [ranking]);

  const visible = useMemo(() => {
    const query = filters.query.trim().toLowerCase();

    const filtered = ranking.filter((player) => {
      if (filters.role !== 'ALL' && player.role !== filters.role) return false;
      if (filters.liveOnly && !player.inGame) return false;
      if (!query) return true;
      return (
        player.displayName.toLowerCase().includes(query) ||
        `${player.gameName}#${player.tagLine}`.toLowerCase().includes(query)
      );
    });

    // Comparators always order best-first; `reverse` is applied here so every
    // column gets the flip for free instead of each one knowing about it.
    const compare = comparatorFor(filters.sort);
    return [...filtered].sort(
      filters.reverse ? (a, b) => compare(b, a) : compare,
    );
  }, [ranking, filters]);

  // Derived rather than stored: an unknown section in the URL lands on the
  // ranking, and the shells tab reverts on its own the moment there is no
  // session behind it — including on first paint, while the session is still
  // loading.
  const requested = oneOf(route.tab, SECTIONS, 'ranking');
  const section: Section =
    requested === 'shells' && !user ? 'ranking' : requested;

  // Resolved from the live ranking rather than stored, so an open card keeps
  // updating when a refresh lands mid-view. A player id that is not on the
  // board (stale link, removed player) simply shows no card.
  const selected = route.player
    ? (ranking.find((player) => player.id === route.player) ?? null)
    : null;

  const openPlayer = useCallback((id: string) => {
    navigate({ player: id, view: null });
  }, []);

  const sections = [
    { id: 'ranking' as const, label: 'Ranking' },
    {
      id: 'live' as const,
      label: 'En vivo',
      // The badge is the point of the tab: it tells you to look without looking.
      badge: liveCount > 0 ? String(liveCount) : undefined,
    },
    { id: 'stats' as const, label: 'Estadísticas' },
    // Public: the board reads for anyone, and only editing needs a session.
    { id: 'tierlist' as const, label: 'Tier list' },
    // Watching is public too; uploading and liking are what need an account.
    { id: 'clips' as const, label: 'Clips' },
    // Signing in is what unlocks the tab; showing it while signed out would
    // only lead to a dead end.
    ...(user ? [{ id: 'shells' as const, label: 'Conchas Azules' }] : []),
  ];

  return (
    <div>
      {/*
        Sticky only from md up. On a phone the three rows below stack into a
        ~150px bar, which would sit on top of a 667px screen permanently and eat
        a fifth of the leaderboard.
      */}
      <nav className="relative z-20 -mx-4 mb-6 flex flex-wrap items-center justify-between gap-3 border-b border-line bg-void/85 px-4 py-3 backdrop-blur-md sm:-mx-6 sm:px-6 md:sticky md:top-0">
        <RefreshMeter
          generatedAt={snapshot.generatedAt}
          nextUpdateAt={snapshot.nextUpdateAt}
          intervalMinutes={snapshot.tournament.refreshIntervalMinutes}
          isRefreshing={isRefreshing}
          source={snapshot.source}
        />

        <div className="order-first w-full lg:order-none lg:w-auto">
          <Tabs
            tabs={sections}
            active={section}
            // Changing section closes any open card: the card belongs to the
            // ranking, and leaving it floating over another tab makes no sense.
            // The ranking is the root, so it has no segment of its own.
            onChange={(id) =>
              navigate({
                tab: id === HOME_SECTION ? null : id,
                player: null,
                view: null,
              })
            }
            label="Secciones de la página"
          />
        </div>

        <div className="flex items-center gap-2">
          <NotifyButton />
          <RulesButton tournament={snapshot.tournament} />
          <SignupButton />
          <DiscordLink />
          <TournamentClock tournament={snapshot.tournament} />
          <AccountChip
            user={user}
            onSignOut={() => {
              signOut();
              setToken(null);
              setUser(null);
              navigate({ tab: null, player: null, view: null }, 'replace');
            }}
          />
        </div>
      </nav>

      <TournamentProgress tournament={snapshot.tournament} />

      {error && (
        <p
          role="alert"
          className="mt-4 rounded-xl border border-line bg-carbon px-3 py-2 text-fluid-xs"
          style={{ color: 'var(--color-mark-red)' }}
        >
          No se pudo traer la última actualización ({error}). Mostrando la
          última versión que cargó.
        </p>
      )}

      <div className="mt-6">
        <TabPanel id="ranking" active={section === 'ranking'}>
          {/* The podium always shows the true top three, never the filtered view. */}
          <Podium players={ranking} onSelect={(p) => openPlayer(p.id)} />
          <Filters
            value={filters}
            onChange={setFilters}
            counts={counts}
            liveCount={liveCount}
            resultCount={visible.length}
          />
          <RankingTable
            players={visible}
            rosterSize={ranking.length}
            loading={isRefreshing}
            onSelect={(p) => openPlayer(p.id)}
            sort={filters.sort}
            reverse={filters.reverse}
            onSort={sortBy}
          />
        </TabPanel>

        <TabPanel id="live" active={section === 'live'}>
          <LiveGames
            players={ranking}
            onSelect={openPlayer}
            user={user}
            token={token}
            onWalletChange={() => void loadSession()}
            feed={liveFeed}
          />
        </TabPanel>

        <TabPanel id="stats" active={section === 'stats'}>
          <div className="space-y-4">
            <StatsPanel players={ranking} duos={snapshot.duos} />

            <div className="grid gap-4 xl:grid-cols-[minmax(0,24rem)_1fr]">
              <BestDays players={ranking} dailyDeltas={snapshot.dailyDeltas} />
              <EloEvolution players={ranking} lpSeries={snapshot.lpSeries} />
            </div>
          </div>
        </TabPanel>

        <TabPanel id="shells" active={section === 'shells'}>
          <BlueShells
            user={user}
            token={token}
            players={ranking}
            onBalanceChange={() => void loadSession()}
            revision={revision}
          />
        </TabPanel>

        <TabPanel id="tierlist" active={section === 'tierlist'}>
          <TierList players={ranking} user={user} token={token} revision={revision} />
        </TabPanel>

        <TabPanel id="clips" active={section === 'clips'}>
          <Clips user={user} token={token} players={ranking} revision={revision} />
        </TabPanel>
      </div>

      {selected && (
        <PlayerDetail
          player={selected}
          snapshot={snapshot}
          allPlayers={ranking}
          tab={route.view}
          // Replace, not push: the inner tabs should not become stops the back
          // button has to walk through before it closes the card.
          onTabChange={(id) => navigate({ view: id }, 'replace')}
          onClose={() => navigate({ player: null, view: null })}
        />
      )}
    </div>
  );
}

/** Signed-out shows a login button; signed-in shows who you are. */
function AccountChip({
  user,
  onSignOut,
}: {
  user: SessionUser | null;
  onSignOut: () => void;
}) {
  if (!user) {
    return (
      <a
        href={loginUrl()}
        className="eyebrow inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border border-line px-3 text-ink-2 transition-colors hover:border-[color:var(--color-accent)] hover:text-ink"
      >
        <ShellMark size={14} />
        Entrar
      </a>
    );
  }

  const avatar = avatarUrl(user);

  return (
    <span className="inline-flex shrink-0 items-center gap-2 rounded-full border border-line bg-carbon/80 py-1 pr-1 pl-1.5 backdrop-blur">
      {avatar ? (
        <img
          src={avatar}
          alt=""
          width={26}
          height={26}
          className="h-[26px] w-[26px] rounded-full"
        />
      ) : (
        <span className="grid h-[26px] w-[26px] place-items-center rounded-full bg-carbon-3 text-[0.65rem]">
          {user.username.slice(0, 2).toUpperCase()}
        </span>
      )}

      <span className="hidden max-w-[9rem] truncate text-fluid-xs sm:inline">
        {user.username}
      </span>

      {user.shells && (
        <span
          className="tabular inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold"
          style={{
            color: 'var(--color-accent)',
            background: 'color-mix(in oklab, var(--color-accent) 14%, transparent)',
          }}
          title="Conchas azules disponibles"
        >
          <ShellMark size={11} />
          {user.shells.available}
        </span>
      )}

      {user.coins && (
        <span
          className="tabular inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[0.68rem] font-semibold"
          style={{
            color: COIN_GOLD,
            background: `color-mix(in oklab, ${COIN_GOLD} 14%, transparent)`,
          }}
          title={
            user.coins.isSpectator
              ? `Monedas. Ganás ${SPECTATOR_DAILY_GRANT} por día hasta ${user.coins.cap}.`
              : `Monedas. Hoy llevás ${user.coins.earnedToday} de ${user.coins.dailyCap}.`
          }
        >
          <CoinMark size={11} />
          {user.coins.coins}
          <span className="font-normal opacity-60">/{user.coins.cap}</span>
        </span>
      )}

      <button
        type="button"
        onClick={onSignOut}
        className="eyebrow rounded-full px-2 py-1 text-ink-3 transition-colors hover:text-ink"
        aria-label="Cerrar sesión"
      >
        Out
      </button>
    </span>
  );
}

function comparatorFor(sort: SortKey) {
  return (
    a: ReturnType<typeof buildRanking>[number],
    b: ReturnType<typeof buildRanking>[number],
  ): number => {
    switch (sort) {
      case 'gained':
        return b.ladderPointsGained - a.ladderPointsGained;
      case 'winrate':
        return b.winRate - a.winRate;
      case 'kda':
        return b.kda - a.kda;
      case 'games':
        return b.totals.games - a.totals.games;
      case 'duo':
        return b.duoGames - a.duoGames;
      case 'shells':
        return b.shells - a.shells;
      case 'streak':
        // Signed: a positive run is a win streak, a negative one a losing run,
        // so this reads best form to worst across the whole table.
        return b.streak - a.streak;
      case 'ladder':
      default:
        return a.position - b.position;
    }
  };
}
