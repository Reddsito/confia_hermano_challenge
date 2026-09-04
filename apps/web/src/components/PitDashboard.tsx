import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import {
  buildRanking,
  SPECTATOR_DAILY_GRANT,
  type Snapshot,
} from '@challenge/core/domain';

import { SNAPSHOT_ENDPOINT } from '../lib/api';
import {
  avatarUrl,
  captureSessionFromUrl,
  fetchMe,
  loginUrl,
  readToken,
  signOut,
  type SessionUser,
} from '../lib/session';
import { navigate, oneOf, setBasePath, useRoute } from '../lib/route';
import { BlueShells, CoinMark, COIN_GOLD, ShellMark } from './BlueShells';
import { Classification } from './Classification';
import { Clips } from './Clips';
import { Shop } from './Shop';
import { BetsHowTo, ShopHowTo } from './HowToContent';
import { Duels } from './Duels';
import { BestDays, EloEvolution } from './EloCharts';
import { LiveGames, useLiveFeed } from './LiveGames';
import { NotifyButton } from './Notify';
import { PlayerDetail } from './PlayerDetail';
import { RulesButton } from './Rules';
import { DiscordLink, SignupButton } from './Signup';
import { TabPanel } from './Tabs';
import { Stats } from './Stats';
import { TierList } from './TierList';
import { classNames } from './ui';

/** See `Dashboard`: the check is free until the countdown runs out. */
const POLL_CHECK_MS = 3_000;

/**
 * The alternate information architecture, at `/demo`.
 *
 * The production dashboard opens on a podium and a stats tab built from the
 * four numbers every scoreboard already shows. This one opens on a timing
 * board, and it splits what used to be one "Estadísticas" tab into two: the
 * measures nobody could compare before, and the head-to-head records the
 * backend has always computed and never displayed.
 */
export const PIT_SECTIONS = [
  'grid',
  'track',
  'stats',
  'duels',
  'traces',
  'shells',
  'shop',
  'tierlist',
  'clips',
] as const;

type PitSection = (typeof PIT_SECTIONS)[number];

/** Lives at the mount point itself; every other section gets a segment. */
export const PIT_HOME: PitSection = 'grid';

export function PitDashboard({
  initialSnapshot,
  basePath = 'demo',
}: {
  initialSnapshot: Snapshot;
  basePath?: string;
}) {
  setBasePath(basePath);

  const [snapshot, setSnapshot] = useState(initialSnapshot);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [user, setUser] = useState<SessionUser | null>(null);
  const [revision, setRevision] = useState(0);
  const [sessionReady, setSessionReady] = useState(false);

  const route = useRoute();
  const inFlight = useRef(false);

  const loadSession = useCallback(async () => {
    const stored = captureSessionFromUrl() ?? readToken();
    setToken(stored);
    try {
      setUser(stored ? await fetchMe(stored) : null);
    } finally {
      setSessionReady(true);
    }
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
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      inFlight.current = false;
      setIsRefreshing(false);
    }
  }, []);

  const refreshAll = useCallback(async () => {
    await Promise.allSettled([refresh(), loadSession()]);
    setRevision((value) => value + 1);
  }, [refresh, loadSession]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    const dueAt = Date.parse(snapshot.nextUpdateAt);

    const tick = () => {
      if (document.visibilityState !== 'visible') return;
      if (Date.now() >= dueAt) void refreshAll();
    };

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

  const liveFeed = useLiveFeed();

  const ranking = useMemo(() => buildRanking(snapshot), [snapshot]);
  const liveCount = useMemo(
    () => ranking.filter((player) => player.inGame).length,
    [ranking],
  );

  const section = oneOf(route.tab, PIT_SECTIONS, PIT_HOME);

  const selected = route.player
    ? (ranking.find((player) => player.id === route.player) ?? null)
    : null;

  const openPlayer = useCallback((id: string) => {
    navigate({ player: id, view: null });
  }, []);

  const channels: { id: PitSection; label: string; badge?: string }[] = [
    { id: 'grid', label: 'Parrilla' },
    {
      id: 'track',
      label: 'En pista',
      badge: liveCount > 0 ? String(liveCount) : undefined,
    },
    { id: 'stats', label: 'Estadísticas' },
    { id: 'duels', label: 'Duelos' },
    { id: 'traces', label: 'Trazadas' },
    { id: 'tierlist', label: 'Tier list' },
    { id: 'clips', label: 'Clips' },
    // Always listed, signed in or not. A tab that vanishes when you are logged
    // out does not read as locked, it reads as missing — which is exactly how
    // it was reported.
    { id: 'shells', label: 'Conchas' },
    { id: 'shop', label: 'Tienda' },
  ];

  return (
    <div>
      <div className="grid gap-5 lg:grid-cols-[13.5rem_minmax(0,1fr)] lg:items-start">
        {/*
          A rail, not a strip. Nine channels and six controls across the top ran
          out of width and turned the header into a wall of labels; down the
          side each one gets its own line, and the board below gets the whole
          page back.
        */}
        <aside className="lg:sticky lg:top-4">
          {/* Wraps inside the rail instead of running past it: the chip grows
              with the username and the two balances, and a fixed-width column
              cannot be asked to hold something of unknown width. */}
          <div className="mb-3 flex w-full min-w-0 flex-wrap items-center gap-2">
            <SyncLight
              isRefreshing={isRefreshing}
              generatedAt={snapshot.generatedAt}
              nextUpdateAt={snapshot.nextUpdateAt}
            />
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

          <nav
            className="-mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0"
            aria-label="Canales"
          >
            {channels.map((channel) => {
              const active = section === channel.id;
              return (
                <button
                  key={channel.id}
                  type="button"
                  aria-current={active ? 'page' : undefined}
                  onClick={() =>
                    navigate({
                      tab: channel.id === PIT_HOME ? null : channel.id,
                      player: null,
                      view: null,
                    })
                  }
                  className={classNames(
                    // Marked by a lit leading edge, the way a selected input is
                    // marked on a mixing desk.
                    'eyebrow relative flex shrink-0 items-center gap-2 border border-line px-3 py-2.5 whitespace-nowrap transition-colors lg:w-full lg:border-x-0 lg:border-t-0',
                    active
                      ? 'text-[color:var(--color-accent)]'
                      : 'text-ink-3 hover:text-ink-2',
                  )}
                >
                  <span
                    aria-hidden
                    className="absolute inset-y-0 left-0 w-[2px] transition-colors"
                    style={{
                      background: active ? 'var(--color-accent)' : 'transparent',
                    }}
                  />
                  {channel.label}
                  {channel.badge && (
                    <span
                      className="tabular ml-auto rounded-sm px-1.5 py-0.5 text-[0.6rem]"
                      style={{
                        color: 'var(--color-void)',
                        background: 'var(--color-accent)',
                      }}
                    >
                      {channel.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4 lg:flex-col lg:items-stretch">
            <RulesButton tournament={snapshot.tournament} />
            <SignupButton />
            <NotifyButton />
            <DiscordLink />
          </div>
        </aside>

        <div className="min-w-0">

      {error && (
        <p
          role="alert"
          className="mb-4 rounded-xl border border-line bg-carbon px-3 py-2 text-fluid-xs"
          style={{ color: 'var(--color-mark-red)' }}
        >
          Sin señal con el muro ({error}). Mostrando la última vuelta que llegó.
        </p>
      )}

      <TabPanel id="grid" active={section === 'grid'}>
        <Classification players={ranking} onSelect={openPlayer} />
      </TabPanel>

      <TabPanel id="track" active={section === 'track'}>
        <div className="mb-3 flex justify-end">
          <BetsHowTo />
        </div>
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
        <Stats players={ranking} duos={snapshot.duos} />
      </TabPanel>

      <TabPanel id="duels" active={section === 'duels'}>
        <Duels players={ranking} headToHead={snapshot.headToHead} />
      </TabPanel>

      <TabPanel id="traces" active={section === 'traces'}>
        <div className="grid gap-4 xl:grid-cols-[minmax(0,24rem)_1fr]">
          <BestDays players={ranking} dailyDeltas={snapshot.dailyDeltas} />
          <EloEvolution players={ranking} lpSeries={snapshot.lpSeries} />
        </div>
      </TabPanel>

      <TabPanel id="shells" active={section === 'shells'}>
        {user && token ? (
          <BlueShells
            user={user}
            token={token}
            players={ranking}
            onBalanceChange={() => void loadSession()}
            revision={revision}
          />
        ) : (
          <SignInWall
            ready={sessionReady}
            title="Conchas azules"
            body="Entrá con Discord para ver tu inventario, tirar conchas y seguir las deudas del resto."
          />
        )}
      </TabPanel>

      <TabPanel id="shop" active={section === 'shop'}>
        <div className="mb-3 flex justify-end">
          <ShopHowTo />
        </div>

        {user && token ? (
          <Shop
            user={user}
            token={token}
            onWalletChange={() => void loadSession()}
            revision={revision}
          />
        ) : (
          <SignInWall
            ready={sessionReady}
            title="Tienda"
            body="Entrá con Discord para gastar tus monedas. Se ganan jugando, y también mirando."
          />
        )}
      </TabPanel>

      <TabPanel id="tierlist" active={section === 'tierlist'}>
        <TierList players={ranking} user={user} token={token} revision={revision} />
      </TabPanel>

      <TabPanel id="clips" active={section === 'clips'}>
        <Clips user={user} token={token} players={ranking} revision={revision} />
      </TabPanel>

        </div>
      </div>

      {selected && (
        <PlayerDetail
          player={selected}
          snapshot={snapshot}
          allPlayers={ranking}
          tab={route.view}
          onTabChange={(id) => navigate({ view: id }, 'replace')}
          onClose={() => navigate({ player: null, view: null })}
        />
      )}
    </div>
  );
}

/**
 * What a signed-out reader gets instead of a missing tab: the name of the
 * thing, why it needs an account, and the way in.
 */
function SignInWall({
  ready,
  title,
  body,
}: {
  ready: boolean;
  title: string;
  body: string;
}) {
  // Held blank until the session has actually resolved, so somebody who is
  // signed in never sees "entrá" flash before their own inventory.
  if (!ready) {
    return (
      <p className="px-4 py-16 text-center text-fluid-sm text-ink-3">
        Comprobando sesión…
      </p>
    );
  }

  return (
    <section className="rounded-xl border border-line bg-carbon px-6 py-14 text-center">
      <h3 className="display text-fluid-lg leading-none">{title}</h3>
      <p className="mx-auto mt-3 max-w-md text-fluid-sm text-ink-2">{body}</p>
      <a
        href={loginUrl()}
        className="eyebrow mt-6 inline-flex items-center gap-2 rounded-sm border px-4 py-2.5 transition-colors"
        style={{
          borderColor: 'var(--color-accent)',
          color: 'var(--color-accent)',
        }}
      >
        <ShellMark size={14} />
        Entrar con Discord
      </a>
    </section>
  );
}

/**
 * The sync indicator, reduced to what it has to say: a light, and how long ago
 * the wall last heard from the timing loop. The production meter draws a full
 * countdown rail; up here that rail would compete with the channel strip it
 * sits inside.
 */
function SyncLight({
  isRefreshing,
  generatedAt,
  nextUpdateAt,
}: {
  isRefreshing: boolean;
  generatedAt: string;
  nextUpdateAt: string;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  const age = Math.max(0, Math.round((now - Date.parse(generatedAt)) / 1000));
  const due = Math.max(0, Math.round((Date.parse(nextUpdateAt) - now) / 1000));

  const label = isRefreshing
    ? 'SYNC'
    : age < 60
      ? `${age}s`
      : `${Math.floor(age / 60)}m`;

  return (
    <span
      className="eyebrow inline-flex items-center gap-1.5 rounded-sm border border-line px-2 py-1.5 text-ink-3"
      title={`Última vuelta hace ${age}s · próxima en ${due}s`}
    >
      <span
        className={classNames(
          'live-dot inline-block h-1.5 w-1.5',
          isRefreshing && 'animate-pulse',
        )}
        style={{
          background: isRefreshing
            ? 'var(--color-accent)'
            : 'var(--color-mark-teal)',
        }}
      />
      {label}
    </span>
  );
}

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
        className="eyebrow inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line px-2.5 py-1.5 text-ink-2 transition-colors hover:border-[color:var(--color-accent)] hover:text-ink"
      >
        <ShellMark size={13} />
        Entrar
      </a>
    );
  }

  const avatar = avatarUrl(user);

  return (
    <span className="inline-flex min-w-0 max-w-full flex-wrap items-center gap-1.5 rounded-sm border border-line bg-carbon px-1.5 py-1">
      {avatar ? (
        <img
          src={avatar}
          alt=""
          width={22}
          height={22}
          className="h-[22px] w-[22px] rounded-full"
        />
      ) : (
        <span className="grid h-[22px] w-[22px] place-items-center rounded-sm bg-carbon-3 text-[0.6rem]">
          {user.username.slice(0, 2).toUpperCase()}
        </span>
      )}

      <span className="min-w-0 max-w-[6rem] truncate text-fluid-xs">
        {user.username}
      </span>

      {user.shells && (
        <span
          className="tabular inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[0.65rem]"
          style={{
            color: 'var(--color-accent)',
            background:
              'color-mix(in oklab, var(--color-accent) 14%, transparent)',
          }}
          title="Conchas disponibles"
        >
          <ShellMark size={10} />
          {user.shells.available}
        </span>
      )}

      {user.coins && (
        <span
          className="tabular inline-flex items-center gap-1 rounded-sm px-1.5 py-0.5 text-[0.65rem]"
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
          <CoinMark size={10} />
          {user.coins.coins}
        </span>
      )}

      <button
        type="button"
        onClick={onSignOut}
        className="eyebrow rounded-sm px-1.5 py-1 text-ink-3 transition-colors hover:text-ink"
        aria-label="Cerrar sesión"
      >
        Out
      </button>
    </span>
  );
}
