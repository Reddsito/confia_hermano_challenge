import { useMemo, useState } from 'react';

import {
  ROLES,
  formatRankShort,
  type RankedPlayer,
  type Role,
} from '@challenge/core/domain';

import { Avatar, classNames, formatPercent, tierColor } from './ui';

/**
 * The board.
 *
 * A ladder race is a timing problem, so it is read like one. The production
 * table answers "what are this player's stats"; this one answers the two
 * questions a leaderboard is actually for — how far off the lead am I, and who
 * is within reach. GAP and INT are the whole point, and they are the only two
 * columns that never drop on a narrow screen.
 */

type SortKey = 'position' | 'gained' | 'winRate' | 'kda' | 'games';

const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: 'position', label: 'POS', title: 'Posición en la ladder' },
  { key: 'gained', label: 'LP', title: 'LP ganados desde el arranque' },
  { key: 'winRate', label: 'WR', title: 'Winrate' },
  { key: 'kda', label: 'KDA', title: 'KDA' },
  { key: 'games', label: 'PJ', title: 'Partidas jugadas' },
];

/** Signed LP, in the language of a timing screen. */
function gapLabel(points: number): string {
  if (points <= 0) return '—';
  return `+${points.toLocaleString()}`;
}

export function Classification({
  players,
  onSelect,
}: {
  players: RankedPlayer[];
  onSelect: (id: string) => void;
}) {
  const [role, setRole] = useState<Role | 'ALL'>('ALL');
  const [query, setQuery] = useState('');
  const [liveOnly, setLiveOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>('position');

  const leader = players[0] ?? null;

  /**
   * Gaps are computed against the true ladder order, before any filter runs.
   * A gap that changes because you typed in a search box is not a gap.
   */
  const timed = useMemo(() => {
    const leaderPoints = players[0]?.ladderPoints ?? 0;
    return players.map((player, index) => ({
      player,
      gap: leaderPoints - player.ladderPoints,
      interval:
        index === 0 ? 0 : (players[index - 1]?.ladderPoints ?? 0) - player.ladderPoints,
    }));
  }, [players]);

  const counts = useMemo(() => {
    const result = { ALL: players.length } as Record<Role | 'ALL', number>;
    for (const value of ROLES) {
      result[value] = players.filter((player) => player.role === value).length;
    }
    return result;
  }, [players]);

  const liveCount = players.filter((player) => player.inGame).length;

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();

    const filtered = timed.filter(({ player }) => {
      if (role !== 'ALL' && player.role !== role) return false;
      if (liveOnly && !player.inGame) return false;
      if (!needle) return true;
      return (
        player.displayName.toLowerCase().includes(needle) ||
        `${player.gameName}#${player.tagLine}`.toLowerCase().includes(needle)
      );
    });

    if (sort === 'position') return filtered;

    const value = (row: (typeof timed)[number]): number => {
      switch (sort) {
        case 'gained':
          return row.player.ladderPointsGained;
        case 'winRate':
          return row.player.winRate;
        case 'kda':
          return row.player.kda;
        case 'games':
          return row.player.totals.games;
        default:
          return -row.player.position;
      }
    };

    return [...filtered].sort((a, b) => value(b) - value(a));
  }, [timed, role, query, liveOnly, sort]);

  if (players.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-carbon px-4 py-10 text-center text-fluid-sm text-ink-3">
        Todavía no hay nadie en pista.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      {leader && <LeaderBoard leader={leader} chaser={players[1] ?? null} />}

      <ControlBar
        role={role}
        onRole={setRole}
        counts={counts}
        query={query}
        onQuery={setQuery}
        liveOnly={liveOnly}
        onLiveOnly={setLiveOnly}
        liveCount={liveCount}
        shown={rows.length}
        total={players.length}
      />

      <div className="overflow-x-auto rounded-xl border border-line bg-carbon">
        <table className="w-full border-collapse text-left">
          <thead>
            <tr className="border-b border-line-strong">
              <Th className="w-14 text-center">POS</Th>
              <Th className="w-10" />
              <Th>Piloto</Th>
              <Th className="hidden w-28 sm:table-cell">Rango</Th>
              <Th className="w-20 text-right" title="Diferencia con el líder">
                GAP
              </Th>
              <Th
                className="w-20 text-right"
                title="Diferencia con quien va justo delante"
              >
                INT
              </Th>
              {COLUMNS.slice(1).map((column) => (
                <Th
                  key={column.key}
                  className="hidden w-20 text-right md:table-cell"
                  title={column.title}
                  onClick={() =>
                    setSort((current) =>
                      current === column.key ? 'position' : column.key,
                    )
                  }
                  active={sort === column.key}
                >
                  {column.label}
                </Th>
              ))}
              <Th className="hidden w-28 lg:table-cell">Forma</Th>
              <Th className="w-24 text-right">Estado</Th>
            </tr>
          </thead>

          <tbody>
            {rows.map(({ player, gap, interval }) => (
              <Row
                key={player.id}
                player={player}
                gap={gap}
                interval={interval}
                onSelect={onSelect}
              />
            ))}
          </tbody>
        </table>

        {rows.length === 0 && (
          <p className="px-4 py-10 text-center text-fluid-sm text-ink-3">
            Ningún piloto coincide con el filtro.
          </p>
        )}
      </div>
    </section>
  );
}

/**
 * The lead, stated once at instrument size. Not a podium: a podium ranks three
 * people against each other, and the only comparison that matters at the front
 * of a race is the one between P1 and whoever is closest to taking it.
 */
function LeaderBoard({
  leader,
  chaser,
}: {
  leader: RankedPlayer;
  chaser: RankedPlayer | null;
}) {
  const margin = chaser ? leader.ladderPoints - chaser.ladderPoints : 0;

  return (
    <div
      className="neon flex flex-wrap items-center gap-x-8 gap-y-4 rounded-xl border bg-carbon px-4 py-4 sm:px-6"
      style={{ ['--tier' as string]: tierColor(leader.rank) }}
    >
      <div className="flex items-center gap-4">
        <Avatar
          name={leader.displayName}
          iconId={leader.profileIconId}
          size={54}
          inGame={leader.inGame}
        />
        <div className="min-w-0">
          <p className="eyebrow text-ink-3">Líder de la carrera</p>
          <p className="display truncate text-fluid-xl leading-none">
            {leader.displayName}
          </p>
          <p className="tabular mt-1 text-fluid-xs neon-text">
            {formatRankShort(leader.rank)}
          </p>
        </div>
      </div>

      <dl className="flex flex-wrap items-center gap-x-8 gap-y-3">
        <Readout
          label="Ventaja"
          value={margin > 0 ? `+${margin.toLocaleString()}` : '—'}
          hint={chaser ? `sobre ${chaser.displayName}` : 'sin perseguidor'}
        />
        <Readout
          label="LP ganados"
          value={
            leader.ladderPointsGained >= 0
              ? `+${leader.ladderPointsGained.toLocaleString()}`
              : leader.ladderPointsGained.toLocaleString()
          }
          tone={leader.ladderPointsGained >= 0 ? 'up' : 'down'}
        />
        <Readout label="Partidas" value={leader.totals.games.toLocaleString()} />
        <Readout
          label="Winrate"
          value={
            leader.totals.games > 0 ? formatPercent(leader.winRate, 1) : '—'
          }
        />
      </dl>
    </div>
  );
}

function Readout({
  label,
  value,
  hint,
  tone,
}: {
  label: string;
  value: string;
  hint?: string;
  tone?: 'up' | 'down';
}) {
  return (
    <div>
      <dt className="eyebrow text-ink-3">{label}</dt>
      <dd
        className="tabular text-fluid-lg leading-tight"
        style={{
          color:
            tone === 'up'
              ? 'var(--color-mark-teal)'
              : tone === 'down'
                ? 'var(--color-mark-red)'
                : undefined,
        }}
      >
        {value}
      </dd>
      {hint && <p className="text-fluid-xs text-ink-3">{hint}</p>}
    </div>
  );
}

/** Role chips, a search field and the live toggle, in one instrument strip. */
function ControlBar({
  role,
  onRole,
  counts,
  query,
  onQuery,
  liveOnly,
  onLiveOnly,
  liveCount,
  shown,
  total,
}: {
  role: Role | 'ALL';
  onRole: (value: Role | 'ALL') => void;
  counts: Record<Role | 'ALL', number>;
  query: string;
  onQuery: (value: string) => void;
  liveOnly: boolean;
  onLiveOnly: (value: boolean) => void;
  liveCount: number;
  shown: number;
  total: number;
}) {
  const chips: (Role | 'ALL')[] = ['ALL', ...ROLES];

  return (
    <div className="flex flex-wrap items-center gap-2 rounded-xl border border-line bg-carbon px-3 py-2">
      <div className="flex flex-wrap gap-1">
        {chips.map((value) => (
          <button
            key={value}
            type="button"
            onClick={() => onRole(value)}
            aria-pressed={role === value}
            className={classNames(
              'eyebrow rounded-md border px-2.5 py-1.5 transition-colors',
              role === value
                ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
                : 'border-line text-ink-3 hover:text-ink-2',
            )}
          >
            {value === 'ALL' ? 'TODOS' : value}
            <span className="ml-1.5 opacity-50">{counts[value] ?? 0}</span>
          </button>
        ))}
      </div>

      <button
        type="button"
        onClick={() => onLiveOnly(!liveOnly)}
        aria-pressed={liveOnly}
        className={classNames(
          'eyebrow inline-flex items-center gap-1.5 rounded-md border px-2.5 py-1.5 transition-colors',
          liveOnly
            ? 'border-[color:var(--color-accent)] text-[color:var(--color-accent)]'
            : 'border-line text-ink-3 hover:text-ink-2',
        )}
      >
        <span
          className="live-dot inline-block h-1.5 w-1.5"
          style={{ background: 'var(--color-accent)' }}
        />
        EN JUEGO {liveCount}
      </button>

      <input
        value={query}
        onChange={(event) => onQuery(event.target.value)}
        placeholder="Buscar piloto…"
        aria-label="Buscar piloto"
        className="min-w-0 flex-1 rounded-md border border-line bg-carbon-2 px-3 py-1.5 text-fluid-sm text-ink outline-none placeholder:text-ink-3 focus:border-[color:var(--color-accent)]"
      />

      <p className="eyebrow shrink-0 text-ink-3">
        {shown}/{total}
      </p>
    </div>
  );
}

function Th({
  children,
  className,
  title,
  onClick,
  active,
}: {
  children?: React.ReactNode;
  className?: string;
  title?: string;
  onClick?: () => void;
  active?: boolean;
}) {
  return (
    <th
      scope="col"
      title={title}
      className={classNames(
        'eyebrow px-2 py-2.5 font-normal',
        active ? 'text-[color:var(--color-accent)]' : 'text-ink-3',
        className,
      )}
    >
      {onClick ? (
        <button type="button" onClick={onClick} className="eyebrow">
          {children}
        </button>
      ) : (
        children
      )}
    </th>
  );
}

function Row({
  player,
  gap,
  interval,
  onSelect,
}: {
  player: RankedPlayer;
  gap: number;
  interval: number;
  onSelect: (id: string) => void;
}) {
  const accent = tierColor(player.rank);
  const moved =
    player.previousPosition === null
      ? 0
      : player.previousPosition - player.position;

  return (
    <tr
      onClick={() => onSelect(player.id)}
      className="cursor-pointer border-b border-line transition-colors last:border-b-0 hover:bg-carbon-2"
    >
      <td className="px-2 py-2 text-center">
        <span className="tabular text-fluid-base">{player.position}</span>
      </td>

      <td className="px-1 py-2">
        <Movement moved={moved} />
      </td>

      <td className="px-2 py-2">
        <div className="flex items-center gap-2.5">
          <Avatar
            name={player.displayName}
            iconId={player.profileIconId}
            size={30}
            inGame={player.inGame}
          />
          <div className="min-w-0">
            <p className="truncate text-fluid-sm leading-tight">
              {player.displayName}
            </p>
            <p className="eyebrow text-ink-3">{player.role}</p>
          </div>
        </div>
      </td>

      <td className="hidden px-2 py-2 sm:table-cell">
        <span className="tabular text-fluid-xs" style={{ color: accent }}>
          {formatRankShort(player.rank)}
        </span>
      </td>

      <td className="tabular px-2 py-2 text-right text-fluid-sm text-ink-2">
        {gapLabel(gap)}
      </td>

      <td className="tabular px-2 py-2 text-right text-fluid-sm text-ink-3">
        {gapLabel(interval)}
      </td>

      <td className="tabular hidden px-2 py-2 text-right text-fluid-sm md:table-cell">
        <Signed value={player.ladderPointsGained} />
      </td>

      <td className="tabular hidden px-2 py-2 text-right text-fluid-sm text-ink-2 md:table-cell">
        {player.totals.games > 0 ? formatPercent(player.winRate, 0) : '—'}
      </td>

      <td className="tabular hidden px-2 py-2 text-right text-fluid-sm text-ink-2 md:table-cell">
        {player.totals.games > 0 ? player.kda.toFixed(2) : '—'}
      </td>

      <td className="tabular hidden px-2 py-2 text-right text-fluid-sm text-ink-3 md:table-cell">
        {player.totals.games}
      </td>

      <td className="hidden px-2 py-2 lg:table-cell">
        <Stints results={player.recentResults} />
      </td>

      <td className="px-2 py-2 text-right">
        <Status player={player} />
      </td>
    </tr>
  );
}

/** Positions taken or given back since the last sync. */
function Movement({ moved }: { moved: number }) {
  if (moved === 0) {
    return <span className="block text-center text-ink-3">·</span>;
  }

  const up = moved > 0;
  return (
    <span
      className="tabular flex items-center justify-center gap-0.5 text-[0.68rem]"
      style={{
        color: up ? 'var(--color-mark-teal)' : 'var(--color-mark-red)',
      }}
      title={`${up ? 'Sube' : 'Baja'} ${Math.abs(moved)} ${Math.abs(moved) === 1 ? 'puesto' : 'puestos'}`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(moved)}
    </span>
  );
}

function Signed({ value }: { value: number }) {
  if (value === 0) return <span className="text-ink-3">0</span>;
  return (
    <span
      style={{
        color: value > 0 ? 'var(--color-mark-teal)' : 'var(--color-mark-red)',
      }}
    >
      {value > 0 ? '+' : ''}
      {value.toLocaleString()}
    </span>
  );
}

/**
 * The last five results as a run of bars. Read left to right, oldest to newest,
 * so a hot finish leans right — the opposite of the array's own order.
 */
function Stints({ results }: { results: boolean[] }) {
  const stints = results.slice(0, 5).reverse();

  if (stints.length === 0) {
    return <span className="text-fluid-xs text-ink-3">sin datos</span>;
  }

  return (
    <span className="flex items-end gap-0.5" aria-label="Últimos resultados">
      {stints.map((won, index) => (
        <span
          key={index}
          className="block w-2 rounded-sm"
          style={{
            height: won ? 16 : 9,
            background: won
              ? 'var(--color-mark-teal)'
              : 'var(--color-mark-red)',
            opacity: 0.35 + (index / Math.max(stints.length - 1, 1)) * 0.65,
          }}
          title={won ? 'Victoria' : 'Derrota'}
        />
      ))}
    </span>
  );
}

/** In a game, owing a challenge, or simply running. */
function Status({ player }: { player: RankedPlayer }) {
  if (player.inGame) {
    return (
      <span
        className="eyebrow inline-flex items-center gap-1.5"
        style={{ color: 'var(--color-accent)' }}
      >
        <span
          className="live-dot inline-block h-1.5 w-1.5 animate-pulse"
          style={{ background: 'var(--color-accent)' }}
        />
        EN PISTA
      </span>
    );
  }

  if (player.owes.length > 0) {
    return (
      <span
        className="eyebrow"
        style={{ color: 'var(--color-mark-red)' }}
        title={player.owes.join(' · ')}
      >
        PENALIZADO {player.owes.length}
      </span>
    );
  }

  return <span className="eyebrow text-ink-3">BOXES</span>;
}
