import { useCallback, useEffect, useRef, useState } from 'react';

import type {
  Division,
  Rank,
  RankedPlayer,
  Role,
  Tier,
} from '@challenge/core/domain';

import { BET_WINDOW_SECONDS, bettingOpen } from '@challenge/core/domain';

import { API_URL } from '../lib/api';
import type { SessionUser } from '../lib/session';
import { fetchLiveWagers, type LiveWager } from '../lib/bets';
import { play, readEnabled } from '../lib/sound';
import { BetModal, BetStandingsTable, GameWagers } from './Bets';
import { TierCrest } from './icons';
import { Avatar, classNames, tierColor } from './ui';

interface LiveRank {
  tier: string | null;
  division: string | null;
  lp: number | null;
}

interface LiveParticipant {
  championId: number;
  championName: string;
  championIcon: string;
  teamId: number;
  riotId: string | null;
  playerId: string | null;
  displayName: string | null;
  /**
   * Only ever set for a tracked player — the spectator API reports no position.
   * Teams arrive in Riot's pick order, so this labels a row, never sorts one.
   */
  role: Role | null;
  spellIcons: string[];
  perkIcons: string[];
  rank: LiveRank | null;
  opggUrl: string | null;
}

interface LiveBan {
  teamId: number;
  icon: string;
  name: string;
}

interface LiveGame {
  gameId: number;
  queueId: number;
  queueLabel: string;
  gameLength: number;
  startedAt: number | null;
  bans: LiveBan[];
  trackedPlayerIds: string[];
  inChampSelect: boolean;
  countsForChallenge: boolean;
  allies: LiveParticipant[];
  enemies: LiveParticipant[];
}

/** Matches the sync cadence: fetching faster would only show the same answer. */
const BET_GOLD = '#f2c94c';

const POLL_MS = 30_000;

export interface LiveFeed {
  games: LiveGame[] | null;
  error: boolean;
  wagers: LiveWager[];
  reload: () => void;
}

/**
 * Polls the live feed and blips when a challenge game appears.
 *
 * This lives OUTSIDE the live tab on purpose. `TabPanel` unmounts whatever is
 * not showing, so a poll owned by `LiveGames` only ran while you sat on that
 * tab — which is precisely where you do not need to be told a game started.
 * The Dashboard holds this instead, so the alert works from any tab.
 */
export function useLiveFeed(): LiveFeed {
  const [games, setGames] = useState<LiveGame[] | null>(null);
  const [error, setError] = useState(false);
  const [wagers, setWagers] = useState<LiveWager[]>([]);
  const [beat, setBeat] = useState(0);

  // The ids seen on the previous poll. `null` means we have not polled yet, so
  // the first load never fires the alert — otherwise opening the page during
  // three live games would greet you with three blips.
  const seenRef = useRef<Set<number> | null>(null);

  useEffect(() => {
    let alive = true;

    const load = async () => {
      try {
        const response = await fetch(`${API_URL}/api/live?t=${Date.now()}`, {
          cache: 'no-store',
        });
        if (!response.ok) throw new Error(String(response.status));
        const next = ((await response.json()) as { games: LiveGame[] }).games;
        if (!alive) return;
        setGames(next);
        setError(false);

        const ids = new Set(next.map((game) => game.gameId));
        const seen = seenRef.current;
        seenRef.current = ids;
        // One blip per poll, not one per game: five friends queuing together
        // start five games at once, and that should sound like an event, not
        // an alarm clock.
        if (
          seen &&
          readEnabled() &&
          next.some((game) => game.countsForChallenge && !seen.has(game.gameId))
        ) {
          play();
        }
      } catch {
        if (alive) setError(true);
      }
    };

    // The wagers refresh on the same beat, so a bet placed by somebody else
    // shows up without anyone reloading the page.
    const loadWagers = async () => {
      try {
        const next = await fetchLiveWagers();
        if (alive) setWagers(next);
      } catch {
        if (alive) setWagers([]);
      }
    };

    void load();
    void loadWagers();
    const id = setInterval(() => {
      void load();
      void loadWagers();
    }, POLL_MS);

    return () => {
      alive = false;
      clearInterval(id);
    };
  }, [beat]);

  return {
    games,
    error,
    wagers,
    reload: useCallback(() => setBeat((value) => value + 1), []),
  };
}

export function LiveGames({
  players,
  onSelect,
  user,
  token,
  onWalletChange,
  feed,
}: {
  players: RankedPlayer[];
  onSelect?: (playerId: string) => void;
  user?: SessionUser | null;
  token?: string | null;
  onWalletChange?: () => void;
  feed: LiveFeed;
}) {
  const [betting, setBetting] = useState<{ id: string; name: string } | null>(
    null,
  );
  // Bumped after a wager settles: the ladder is worth re-reading, and the
  // table fetches on its own rather than being handed rows from here.
  const [standingsKey, setStandingsKey] = useState(0);
  const { games, error, wagers } = feed;

  // The ladder is a standing scoreboard, not a property of the live games — it
  // stays on screen even when nobody is playing, so these states only replace
  // the games column instead of returning early for the whole section.
  const column = error ? (
    <Empty
      title="No se puede conectar al backend"
      detail="Las partidas en vivo vienen del servidor, que ahora no responde."
    />
  ) : games === null ? (
    <Empty title="Buscando partidas…" detail="Un momento." />
  ) : games.length === 0 ? (
    <Empty
      title="Nadie está jugando"
      detail="Las partidas aparecen acá a los pocos minutos de empezar. La herramienta de práctica nunca aparece — Riot solo publica partidas que se pueden espectar."
    />
  ) : (
    <div className="grid gap-3 2xl:grid-cols-2">
      {games.map((game) => (
        <GameCard
          key={game.gameId}
          game={game}
          players={players}
          onSelect={onSelect}
          canBet={Boolean(user && token)}
          myPlayerId={user?.playerId ?? null}
          myDiscordId={user?.discordId ?? null}
          wagers={wagers.filter((wager) => wager.gameId === String(game.gameId))}
          onBet={(id, name) => setBetting({ id, name })}
        />
      ))}
    </div>
  );

  return (
    <div className="grid items-start gap-4 xl:grid-cols-[1fr_20rem]">
      {column}

      <BetStandingsTable refreshKey={standingsKey} />

      {betting && user && token && (
        <BetModal
          user={user}
          token={token}
          playerId={betting.id}
          playerName={betting.name}
          onClose={() => setBetting(null)}
          onPlaced={() => {
            setBetting(null);
            setStandingsKey((key) => key + 1);
            feed.reload();
            onWalletChange?.();
          }}
        />
      )}
    </div>
  );
}

/**
 * Seconds elapsed, counted locally.
 *
 * The stored length is only true at the instant the sync cycle read it, and the
 * cycle runs a minute apart — so a clock driven by it would sit still and then
 * jump a minute. Riot also hands back an absolute start time; when it is there
 * the clock is exact, and gameLength is only the fallback for champion select.
 */
function useElapsed(startedAt: number | null, fallbackSeconds: number): number {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (!startedAt) return Math.max(fallbackSeconds, 0);
  return Math.max(Math.floor((now - startedAt) / 1000), 0);
}

function clock(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  return `${minutes}:${String(seconds % 60).padStart(2, '0')}`;
}

function GameCard({
  game,
  players,
  onSelect,
  canBet,
  myPlayerId,
  myDiscordId,
  wagers,
  onBet,
}: {
  game: LiveGame;
  players: RankedPlayer[];
  onSelect?: (playerId: string) => void;
  canBet: boolean;
  myPlayerId: string | null;
  myDiscordId: string | null;
  wagers: LiveWager[];
  onBet: (playerId: string, playerName: string) => void;
}) {
  const elapsed = useElapsed(game.startedAt, game.gameLength);
  const tracked = players.filter((player) =>
    game.trackedPlayerIds.includes(player.id),
  );

  // "Ours" is whichever side a tracked player is on, so blue/red stays stable
  // rather than flipping with Riot's participant order.
  const blueId = game.allies[0]?.teamId ?? 100;

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-carbon">
      <header className="flex items-center gap-3 border-b border-line px-3 py-2">
        <span className="flex -space-x-2">
          {tracked.slice(0, 3).map((player) => (
            <Avatar
              key={player.id}
              name={player.displayName}
              iconId={player.profileIconId}
              size={26}
              ring={tierColor(player.rank)}
            />
          ))}
        </span>

        <span className="tabular mx-auto text-fluid-lg leading-none font-semibold">
          {game.inChampSelect ? 'Selección' : clock(elapsed)}
        </span>

        <span
          className="eyebrow flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[0.6rem]"
          style={{
            color: 'var(--color-mark-red)',
            borderColor:
              'color-mix(in oklab, var(--color-mark-red) 45%, transparent)',
          }}
        >
          <span
            className="live-dot h-1.5 w-1.5 rounded-full"
            style={{ background: 'var(--color-mark-red)' }}
          />
          EN VIVO
        </span>
      </header>

      {/*
        The window is short on purpose, so the row disappears rather than
        offering a button the server is about to refuse. Betting on your own
        game is not a bet, so you are never offered your own name.
      */}
      {canBet && game.countsForChallenge && bettingOpen(elapsed) && (
        <div className="flex flex-wrap items-center gap-2 border-b border-line px-3 py-2">
          <span className="eyebrow text-[0.6rem] text-ink-3">
            Cierra en {clock(Math.max(BET_WINDOW_SECONDS - elapsed, 0))}
          </span>
          {tracked
            .filter((player) => player.id !== myPlayerId)
            .map((player) => (
              <button
                key={player.id}
                type="button"
                onClick={() => onBet(player.id, player.displayName)}
                className="eyebrow min-h-7 rounded-full border px-2.5 text-[0.6rem] transition-colors"
                style={{
                  color: BET_GOLD,
                  borderColor: `color-mix(in oklab, ${BET_GOLD} 45%, transparent)`,
                  backgroundColor: `color-mix(in oklab, ${BET_GOLD} 10%, transparent)`,
                }}
              >
                Apostar a {player.displayName}
              </button>
            ))}
        </div>
      )}

      <GameWagers wagers={wagers} myDiscordId={myDiscordId} />

      {!game.countsForChallenge && (
        <p
          className="px-3 py-1 text-[0.65rem]"
          style={{ color: 'var(--color-mark-amber)' }}
        >
          {game.queueLabel} — no cuenta para el challenge
        </p>
      )}

      <div className="grid gap-px bg-line md:grid-cols-2">
        <Side
          label="LADO AZUL"
          accent="var(--color-mark-teal)"
          participants={game.allies}
          bans={game.bans.filter((ban) => ban.teamId === blueId)}
          onSelect={onSelect}
        />
        <Side
          label="LADO ROJO"
          accent="var(--color-mark-red)"
          participants={game.enemies}
          bans={game.bans.filter((ban) => ban.teamId !== blueId)}
          onSelect={onSelect}
        />
      </div>
    </section>
  );
}

function Side({
  label,
  accent,
  participants,
  bans,
  onSelect,
}: {
  label: string;
  accent: string;
  participants: LiveParticipant[];
  bans: LiveBan[];
  onSelect?: (playerId: string) => void;
}) {
  return (
    <div className="bg-carbon p-2">
      <div className="mb-1.5 flex items-center gap-2 px-1">
        <span className="eyebrow text-[0.6rem]" style={{ color: accent }}>
          {label}
        </span>

        {bans.length > 0 && (
          <span className="ml-auto flex items-center gap-1">
            <span className="eyebrow text-[0.55rem] text-ink-3">BANS</span>
            {bans.map((ban, index) => (
              <img
                key={`${ban.name}-${index}`}
                src={ban.icon}
                alt={ban.name}
                title={ban.name}
                loading="lazy"
                className="h-3.5 w-3.5 rounded opacity-40 grayscale"
              />
            ))}
          </span>
        )}
      </div>

      <ul>
        {participants.map((participant) => (
          <Row
            key={participant.riotId ?? participant.championId}
            participant={participant}
            onSelect={onSelect}
          />
        ))}
      </ul>
    </div>
  );
}

function Row({
  participant,
  onSelect,
}: {
  participant: LiveParticipant;
  onSelect?: (playerId: string) => void;
}) {
  const tracked = participant.playerId !== null;
  // Tracked players open their profile in this app; everyone else has no page
  // here, so the honest destination is their public one.
  const clickable = (tracked && onSelect) || participant.opggUrl;

  const name = participant.displayName ?? participant.riotId?.split('#')[0] ?? '—';
  // The API hands back loose strings; the crest wants the domain shape.
  const rank: Rank | null = participant.rank?.tier
    ? {
        tier: participant.rank.tier as Tier,
        division: (participant.rank.division as Division | null) ?? null,
        leaguePoints: participant.rank.lp ?? 0,
      }
    : null;
  const tag = participant.riotId?.split('#')[1] ?? null;

  const body = (
    <>
      <img
        src={participant.championIcon}
        alt={participant.championName}
        title={participant.championName}
        loading="lazy"
        className="h-8 w-8 shrink-0 rounded"
      />

      <span className="flex shrink-0 flex-col gap-px">
        {participant.spellIcons.map((icon, index) => (
          <img
            key={index}
            src={icon}
            alt=""
            loading="lazy"
            className="h-[15px] w-[15px] rounded-sm"
          />
        ))}
      </span>

      <span className="flex shrink-0 flex-col gap-px">
        {participant.perkIcons.map((icon, index) => (
          <img
            key={index}
            src={icon}
            alt=""
            loading="lazy"
            className="h-[15px] w-[15px]"
          />
        ))}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex items-baseline gap-1">
          <span
            className="truncate text-fluid-xs font-medium"
            style={tracked ? { color: 'var(--color-accent)' } : undefined}
          >
            {name}
          </span>
          {tag && (
            <span className="shrink-0 text-[0.6rem] text-ink-3">#{tag}</span>
          )}
        </span>

        <span className="flex items-center gap-1 text-[0.62rem] text-ink-3">
          {rank ? (
            <>
              <TierCrest rank={rank} size={11} />
              <span className="truncate">
                {rank.tier.charAt(0) + rank.tier.slice(1).toLowerCase()}
                {rank.division ? ` ${rank.division}` : ''}
                {` · ${rank.leaguePoints} LP`}
              </span>
            </>
          ) : (
            <span>Sin clasificar</span>
          )}
        </span>
      </span>
    </>
  );

  const className = classNames(
    'flex w-full items-center gap-1.5 rounded-lg px-1.5 py-1 text-left',
    clickable && 'transition-colors hover:bg-carbon-2',
  );
  const style = tracked
    ? {
        background:
          'color-mix(in oklab, var(--color-accent) 10%, transparent)',
      }
    : undefined;

  return (
    <li>
      {tracked && onSelect ? (
        <button
          type="button"
          className={className}
          style={style}
          onClick={() => onSelect(participant.playerId!)}
        >
          {body}
        </button>
      ) : participant.opggUrl ? (
        <a
          href={participant.opggUrl}
          target="_blank"
          rel="noreferrer noopener"
          className={className}
          style={style}
          title="Ver en OP.GG"
        >
          {body}
        </a>
      ) : (
        <span className={className} style={style}>
          {body}
        </span>
      )}
    </li>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-line bg-carbon p-10 text-center">
      <p className="display text-fluid-lg">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-fluid-sm text-ink-3">{detail}</p>
    </div>
  );
}
