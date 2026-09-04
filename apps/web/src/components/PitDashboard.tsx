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
import { CoinShop } from './CoinShop';
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
    { id: 'shells', label: 'Caparazones' },
    { id: 'shop', label: 'Tienda' },
  ];

  return (
    <div>
      <nav
        className="relative z-20 -mx-4 mb-5 border-y border-line bg-void/90 backdrop-blur-md sm:-mx-6 md:sticky md:top-0"
        aria-label="Canales"
      >
        <div className="flex items-stretch overflow-x-auto px-4 sm:px-6">
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
                  // A channel selector, not a row of pills: the active one is
                  // marked by a lit edge along the top, the way a selected
                  // input is marked on a mixing desk.
                  'eyebrow relative shrink-0 border-r border-line px-4 py-3 whitespace-nowrap transition-colors first:border-l',
                  active
                    ? 'text-[color:var(--color-accent)]'
                    : 'text-ink-3 hover:text-ink-2',
                )}
              >
                <span
                  aria-hidden
                  className="absolute inset-x-0 top-0 h-[2px] transition-colors"
                  style={{
                    background: active ? 'var(--color-accent)' : 'transparent',
                  }}
                />
                {channel.label}
                {channel.badge && (
                  <span
                    className="tabular ml-2 rounded-sm px-1.5 py-0.5 text-[0.6rem]"
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

          <div className="ml-auto flex shrink-0 items-center gap-1.5 py-2 pl-4">
            <SyncLight
              isRefreshing={isRefreshing}
              generatedAt={snapshot.generatedAt}
              nextUpdateAt={snapshot.nextUpdateAt}
            />
            <NotifyButton />
            <RulesButton tournament={snapshot.tournament} />
            <SignupButton />
            <DiscordLink />
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
        </div>
      </nav>

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
            title="Caparazones azules"
            body="Entrá con Discord para ver tu inventario, tirar caparazones y seguir las deudas del resto."
          />
        )}
      </TabPanel>

      <TabPanel id="shop" active={section === 'shop'}>
        {user?.coins && token ? (
          <div className="grid gap-4 lg:grid-cols-[minmax(0,26rem)_1fr]">
            <CoinShop
              wallet={user.coins}
              heldShells={user.shells?.available ?? 0}
              token={token}
              onBought={() => void loadSession()}
            />
            <ShopNotes wallet={user.coins} />
          </div>
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

/** The rules of the currency, next to the thing that spends it. */
function ShopNotes({ wallet }: { wallet: NonNullable<SessionUser['coins']> }) {
  const rows: [string, string][] = [
    ['Hoy llevás', `${wallet.earnedToday} de ${wallet.dailyCap}`],
    ['Tope de cartera', String(wallet.cap)],
    [
      'Cómo se ganan',
      wallet.isSpectator
        ? `${SPECTATOR_DAILY_GRANT} por día por mirar`
        : 'Jugando, y con la entrega diaria',
    ],
  ];

  return (
    <section className="rounded-xl border border-line bg-carbon px-4 py-4">
      <h3 className="display text-fluid-lg leading-none">Cómo funciona</h3>
      <p className="mt-1 text-fluid-xs text-ink-3">
        Las monedas se ganan despacio a propósito: un caparazón cuesta varios
        días, y eso es lo que hace que tirarlo signifique algo.
      </p>

      <dl className="mt-4 divide-y divide-line border-t border-line">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 py-2.5"
          >
            <dt className="eyebrow text-ink-3">{label}</dt>
            <dd className="tabular text-fluid-sm">{value}</dd>
          </div>
        ))}
      </dl>
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
    <span className="inline-flex shrink-0 items-center gap-1.5 rounded-sm border border-line bg-carbon px-1.5 py-1">
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

      <span className="hidden max-w-[7rem] truncate text-fluid-xs sm:inline">
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
          title="Caparazones disponibles"
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
