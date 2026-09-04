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

/** A player with their two timing figures, computed once against the true order. */
interface Timed {
  player: RankedPlayer;
  /** LP behind the leader. */
  gap: number;
  /** LP behind whoever is directly ahead. */
  interval: number;
}

/** The measures a reader can reorder the board by, in column order. */
const COLUMNS: { key: SortKey; label: string; title: string }[] = [
  { key: 'winRate', label: 'WR', title: 'Ordenar por winrate' },
  { key: 'games', label: 'PJ', title: 'Ordenar por partidas jugadas' },
  { key: 'kda', label: 'KDA', title: 'Ordenar por KDA' },
  { key: 'gained', label: 'LP', title: 'Ordenar por LP ganados desde el arranque' },
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
  const [reverse, setReverse] = useState(false);

  /** A new column opens best-first; clicking the active one flips it. */
  const sortBy = (key: SortKey) => {
    if (key === sort) {
      setReverse((current) => !current);
      return;
    }
    setSort(key);
    setReverse(false);
  };

  /**
   * Gaps are computed against the true ladder order, before any filter runs.
   * A gap that changes because you typed in a search box is not a gap.
   */
  const timed = useMemo<Timed[]>(() => {
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

    // Every comparator orders best-first, so `reverse` is applied once here
    // instead of each column having to know which way its own good end points.
    const value = (row: Timed): number => {
      switch (sort) {
        case 'gained':
          return row.player.ladderPointsGained;
        case 'winRate':
          return row.player.winRate;
        case 'kda':
          return row.player.kda;
        case 'games':
          return row.player.totals.games;
        case 'position':
        default:
          // Rank order. Position 1 is the best, so it is negated to keep the
          // "bigger is better" contract the others follow.
          return -row.player.position;
      }
    };

    const sorted = [...filtered].sort((a, b) => value(b) - value(a));
    return reverse ? sorted.reverse() : sorted;
  }, [timed, role, query, liveOnly, sort, reverse]);

  if (players.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-carbon px-4 py-10 text-center text-fluid-sm text-ink-3">
        Todavía no hay nadie en pista.
      </p>
    );
  }

  return (
    <section className="space-y-3">
      {timed.length > 0 && <FrontRow leaders={timed.slice(0, 3)} />}

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
              <Th
                className="w-14 text-center"
                title="Posición en la ladder"
                sortKey="position"
                sort={sort}
                reverse={reverse}
                onSort={sortBy}
              >
                POS
              </Th>
              <Th className="w-10" />
              <Th>Piloto</Th>
              {/* Rank and position are the same ordering, so the column reads
                  as sortable and sorts by the ladder rather than alphabetically
                  by tier name, which would put Bronce above Master. */}
              <Th
                className="hidden w-28 sm:table-cell"
                title="Ordenar por rango"
                sortKey="position"
                sort={sort}
                reverse={reverse}
                onSort={sortBy}
              >
                Rango
              </Th>
              <Th
                className="w-24 text-right"
                title="Cuántos LP le faltan para alcanzar al primero"
              >
                Al líder
              </Th>
              <Th
                className="w-24 text-right"
                title="Cuántos LP le faltan para alcanzar a quien tiene justo delante"
              >
                Al de arriba
              </Th>
              {COLUMNS.map((column) => (
                <Th
                  key={column.key}
                  className="hidden w-20 text-right md:table-cell"
                  title={column.title}
                  sortKey={column.key}
                  sort={sort}
                  reverse={reverse}
                  onSort={sortBy}
                >
                  {column.label}
                </Th>
              ))}
              <Th className="hidden w-28 lg:table-cell">Forma</Th>
              <Th className="w-32 text-right whitespace-nowrap">Estado</Th>
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
 * The front row.
 *
 * Ordered 2-1-3 from the medium breakpoint up, the way a podium is actually
 * built: the winner in the middle and raised, the other two flanking. Below
 * that width the order is plain 1-2-3, because three stacked cards read as a
 * list, and a list that starts at second place is simply wrong.
 *
 * Three cards of equal weight are a row, not a podium, so the place is carried
 * three times over — by the numeral's size, by the height of the card, and by
 * the ghosted digit filling the panel behind it. Every card still shows the
 * same four figures, which is the whole reason to publish a top three instead
 * of a winner.
 */
function FrontRow({ leaders }: { leaders: Timed[] }) {
  /** Podium order at width, reading order without it. */
  const PLACEMENT = ['md:order-2', 'md:order-1', 'md:order-3'];

  return (
    <ol className="grid gap-2 md:grid-cols-3 md:items-end">
      {leaders.map((entry, index) => (
        <li key={entry.player.id} className={PLACEMENT[index]}>
          <PodiumCard entry={entry} />
        </li>
      ))}
    </ol>
  );
}

function PodiumCard({ entry }: { entry: Timed }) {
  const { player, gap } = entry;
  const first = player.position === 1;
  const accent = tierColor(player.rank);

  return (
    <article
      className={classNames(
        'neon relative flex h-full flex-col overflow-hidden rounded-xl border bg-carbon px-4 sm:px-5',
        // The step. Height is what separates first from the other two before a
        // single number has been read.
        first ? 'py-7 md:py-12' : 'py-5 md:py-6',
      )}
      style={{ ['--tier' as string]: accent }}
    >
      {/* The place, at panel scale. Decorative — the real numeral is beside the
          name, and a screen reader should not meet the digit twice. */}
      <span
        aria-hidden
        className="display pointer-events-none absolute -right-2 -bottom-8 leading-none select-none"
        style={{
          color: accent,
          opacity: 0.09,
          fontSize: first
            ? 'clamp(8rem, 5rem + 14vw, 13rem)'
            : 'clamp(6rem, 4rem + 9vw, 9rem)',
        }}
      >
        {player.position}
      </span>

      <div className="relative flex items-center gap-3 sm:gap-4">
        <span
          className="display leading-[0.8]"
          style={{
            color: first ? 'var(--color-accent)' : 'var(--color-ink-2)',
            fontSize: first
              ? 'clamp(3.2rem, 2rem + 4.5vw, 4.6rem)'
              : 'clamp(2.2rem, 1.6rem + 2.4vw, 3.1rem)',
          }}
        >
          {player.position}
        </span>

        <Avatar
          name={player.displayName}
          iconId={player.profileIconId}
          size={first ? 64 : 46}
          inGame={player.inGame}
        />

        <div className="min-w-0 flex-1">
          <p
            className="display truncate leading-none"
            style={{
              fontSize: first
                ? 'clamp(1.4rem, 1rem + 1.6vw, 2rem)'
                : 'clamp(1.05rem, 0.9rem + 0.8vw, 1.35rem)',
            }}
          >
            {player.displayName}
          </p>
          <p className="tabular mt-1.5 text-fluid-xs" style={{ color: accent }}>
            {formatRankShort(player.rank)}
          </p>
        </div>
      </div>

      <dl className="relative mt-5 grid grid-cols-4 gap-2 border-t border-line pt-3">
        <Cell
          label={first ? 'Estado' : 'Al líder'}
          value={first ? 'Líder' : `+${gap.toLocaleString()}`}
          tone={first ? 'lead' : undefined}
        />
        <Cell
          label="WR"
          value={
            player.totals.games > 0 ? formatPercent(player.winRate, 0) : '—'
          }
        />
        <Cell label="PJ" value={String(player.totals.games)} />
        <Cell
          label="LP"
          value={
            player.ladderPointsGained > 0
              ? `+${player.ladderPointsGained.toLocaleString()}`
              : player.ladderPointsGained.toLocaleString()
          }
          tone={player.ladderPointsGained >= 0 ? 'up' : 'down'}
        />
      </dl>
    </article>
  );
}

function Cell({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: 'up' | 'down' | 'lead';
}) {
  const color =
    tone === 'up'
      ? 'var(--color-mark-teal)'
      : tone === 'down'
        ? 'var(--color-mark-red)'
        : tone === 'lead'
          ? 'var(--color-accent)'
          : undefined;

  return (
    <div className="min-w-0">
      <dt className="eyebrow text-ink-3">{label}</dt>
      <dd
        className="tabular mt-1 truncate text-fluid-sm leading-none"
        style={{ color }}
      >
        {value}
      </dd>
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

/**
 * A column header, sortable when it is given a key.
 *
 * The arrow is drawn only on the active column. A caret on every header turns
 * the head row into a row of arrows, and then none of them mean anything.
 */
function Th({
  children,
  className,
  title,
  sortKey,
  sort,
  reverse,
  onSort,
}: {
  children?: React.ReactNode;
  className?: string;
  title?: string;
  sortKey?: SortKey;
  sort?: SortKey;
  reverse?: boolean;
  onSort?: (key: SortKey) => void;
}) {
  const active = sortKey !== undefined && sortKey === sort;

  return (
    <th
      scope="col"
      title={title}
      aria-sort={
        active ? (reverse ? 'ascending' : 'descending') : undefined
      }
      className={classNames(
        'eyebrow px-2 py-2.5 font-normal',
        active ? 'text-[color:var(--color-accent)]' : 'text-ink-3',
        className,
      )}
    >
      {sortKey && onSort ? (
        <button
          type="button"
          onClick={() => onSort(sortKey)}
          className="eyebrow inline-flex items-center gap-1 transition-colors hover:text-ink-2"
        >
          {children}
          {active && (
            <span aria-hidden className="text-[0.55rem]">
              {reverse ? '▲' : '▼'}
            </span>
          )}
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

      <td className="tabular hidden px-2 py-2 text-right text-fluid-sm text-ink-2 md:table-cell">
        {player.totals.games > 0 ? formatPercent(player.winRate, 0) : '—'}
      </td>

      <td className="tabular hidden px-2 py-2 text-right text-fluid-sm text-ink-3 md:table-cell">
        {player.totals.games}
      </td>

      <td className="tabular hidden px-2 py-2 text-right text-fluid-sm text-ink-2 md:table-cell">
        {player.totals.games > 0 ? player.kda.toFixed(2) : '—'}
      </td>

      <td className="tabular hidden px-2 py-2 text-right text-fluid-sm md:table-cell">
        <Signed value={player.ladderPointsGained} />
      </td>

      <td className="hidden px-2 py-2 lg:table-cell">
        <Stints results={player.recentResults} />
      </td>

      <td className="px-2 py-2 text-right whitespace-nowrap">
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
        className="eyebrow inline-flex items-center gap-1.5 whitespace-nowrap"
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
        className="eyebrow whitespace-nowrap"
        style={{ color: 'var(--color-mark-red)' }}
        title={player.owes.join(' · ')}
      >
        PENALIZADO&nbsp;{player.owes.length}
      </span>
    );
  }

  return <span className="eyebrow text-ink-3">BOXES</span>;
}
