import { useMemo } from 'react';

import type { RankedPlayer, Snapshot } from '@challenge/core/domain';

import { Avatar, classNames, formatPercent, tierColor } from './ui';

/**
 * Statistics.
 *
 * The production stats tab ranks the group on the four numbers every scoreboard
 * already shows: kills, deaths, assists, CS. Everything richer — time spent
 * dead, solo kills, first bloods, vision, gold, the hour someone actually
 * queues — is collected by the backend and then buried inside a single player's
 * card, where it can never be compared against anybody.
 *
 * So this panel is built out of exactly that buried half. Each board is a
 * channel with a proportional bar, because the useful question is not "who is
 * first" but "by how much" — a leader at 1.02x the field and a leader at 3x are
 * different stories, and a column of bare numbers tells them identically.
 */

type Extras = NonNullable<RankedPlayer['extras']>;

interface Channel {
  key: string;
  title: string;
  caption: string;
  /** Null drops the player from this board rather than ranking them at zero. */
  pick: (player: RankedPlayer) => number | null;
  format: (value: number) => string;
  /** Whether the biggest number is the good one. Drives the bar colour. */
  goodHigh: boolean;
  minimumGames?: number;
}

const HOURS_PER_BUCKET = 1;
const TOP_N = 8;

function extra(player: RankedPlayer, key: keyof Extras): number | null {
  const value = player.extras?.[key];
  return typeof value === 'number' ? value : null;
}

/** A positive count is worth a board; a zero is worth nothing. */
function positive(value: number | null): number | null {
  return value !== null && value > 0 ? value : null;
}

const CHANNELS: Channel[] = [
  {
    key: 'overtakes',
    title: 'Adelantamientos',
    caption: 'Kills en solitario, sin ayuda',
    pick: (player) => positive(extra(player, 'soloKills')),
    format: (value) => value.toLocaleString(),
    goodHigh: true,
  },
  {
    key: 'lights',
    title: 'Salidas ganadas',
    caption: 'Primeras sangres del equipo',
    pick: (player) => positive(extra(player, 'firstBloods')),
    format: (value) => value.toLocaleString(),
    goodHigh: true,
  },
  {
    key: 'pits',
    title: 'Tiempo en boxes',
    caption: 'Horas muerto esperando respawn',
    pick: (player) => positive(extra(player, 'timeDeadSeconds')),
    format: (value) => `${(value / 3600).toFixed(1)} h`,
    goodHigh: false,
  },
  {
    key: 'vision',
    title: 'Visión',
    caption: 'Puntuación de visión acumulada',
    pick: (player) => positive(extra(player, 'visionScore')),
    format: (value) => value.toLocaleString(),
    goodHigh: true,
  },
  {
    key: 'damage',
    title: 'Daño a campeones',
    caption: 'Total infligido en la sesión',
    pick: (player) => positive(extra(player, 'damageToChampions')),
    format: (value) => `${(value / 1000).toFixed(0)}k`,
    goodHigh: true,
  },
  {
    key: 'taken',
    title: 'Daño encajado',
    caption: 'Total recibido en la sesión',
    pick: (player) => positive(extra(player, 'damageTaken')),
    format: (value) => `${(value / 1000).toFixed(0)}k`,
    goodHigh: false,
  },
  {
    key: 'gold',
    title: 'Oro generado',
    caption: 'Economía acumulada',
    pick: (player) => positive(extra(player, 'goldEarned')),
    format: (value) => `${(value / 1000).toFixed(0)}k`,
    goodHigh: true,
  },
  {
    key: 'spree',
    title: 'Mejor tirada',
    caption: 'Racha de kills más larga sin morir',
    pick: (player) => positive(extra(player, 'largestSpree')),
    format: (value) => `${value} seguidas`,
    goodHigh: true,
  },
  {
    key: 'participation',
    title: 'Participación',
    caption: 'Presencia en las kills del equipo · mínimo 5 partidas',
    pick: (player) => extra(player, 'killParticipation'),
    format: (value) => formatPercent(value, 0),
    goodHigh: true,
    minimumGames: 5,
  },
  {
    key: 'bestKda',
    title: 'Mejor partida',
    caption: 'KDA más alto en una sola partida',
    pick: (player) => positive(extra(player, 'bestKdaGame')),
    format: (value) => value.toFixed(2),
    goodHigh: true,
  },
  {
    key: 'retired',
    title: 'Abandonos',
    caption: 'Partidas rendidas',
    pick: (player) => positive(extra(player, 'surrenders')),
    format: (value) => value.toLocaleString(),
    goodHigh: false,
  },
  {
    key: 'streak',
    title: 'Racha más larga',
    caption: 'Victorias seguidas en toda la sesión',
    pick: (player) => positive(extra(player, 'longestWinStreak')),
    format: (value) => `${value} seguidas`,
    goodHigh: true,
  },
];

export function Stats({
  players,
  duos,
}: {
  players: RankedPlayer[];
  duos: Snapshot['duos'];
}) {
  const totals = useMemo(
    () =>
      players.reduce(
        (accumulator, player) => ({
          games: accumulator.games + player.totals.games,
          wins: accumulator.wins + player.totals.wins,
          minutes: accumulator.minutes + player.totals.minutesPlayed,
          dead: accumulator.dead + (player.extras?.timeDeadSeconds ?? 0),
          gold: accumulator.gold + (player.extras?.goldEarned ?? 0),
          damage:
            accumulator.damage + (player.extras?.damageToChampions ?? 0),
          solo: accumulator.solo + (player.extras?.soloKills ?? 0),
        }),
        { games: 0, wins: 0, minutes: 0, dead: 0, gold: 0, damage: 0, solo: 0 },
      ),
    [players],
  );

  /** Share of the session spent waiting to respawn. The number nobody likes. */
  const deadShare =
    totals.minutes > 0 ? totals.dead / 60 / totals.minutes : 0;

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Partidas" value={totals.games.toLocaleString()} />
        <Tile
          label="Horas en pista"
          value={Math.round(totals.minutes / 60).toLocaleString()}
        />
        <Tile
          label="Winrate del grupo"
          value={
            totals.games > 0 ? formatPercent(totals.wins / totals.games, 1) : '—'
          }
        />
        <Tile
          label="Horas en boxes"
          value={(totals.dead / 3600).toFixed(0)}
          hint={`${formatPercent(deadShare, 1)} del tiempo`}
        />
        <Tile
          label="Adelantamientos"
          value={totals.solo.toLocaleString()}
          hint="kills en solitario"
        />
        <Tile
          label="Daño total"
          value={`${(totals.damage / 1_000_000).toFixed(1)}M`}
        />
      </dl>

      <ActivityClock players={players} />

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {CHANNELS.map((channel) => (
          <ChannelBoard key={channel.key} channel={channel} players={players} />
        ))}
      </div>

      <DuoBoard duos={duos} players={players} />
    </div>
  );
}

/**
 * When the grid actually goes green.
 *
 * `favouriteHour` exists per player and has never been shown next to anybody
 * else's. Stacked across the roster it answers a question the individual number
 * cannot: what time of day is this challenge, really.
 */
function ActivityClock({ players }: { players: RankedPlayer[] }) {
  const buckets = useMemo(() => {
    const counts = new Array(24 / HOURS_PER_BUCKET).fill(0) as number[];
    for (const player of players) {
      const hour = player.extras?.favouriteHour;
      if (typeof hour !== 'number') continue;
      counts[Math.floor(hour / HOURS_PER_BUCKET) % counts.length] += 1;
    }
    return counts;
  }, [players]);

  const peak = Math.max(...buckets, 0);

  if (peak === 0) {
    return null;
  }

  const peakHour = buckets.indexOf(peak) * HOURS_PER_BUCKET;

  return (
    <section className="rounded-xl border border-line bg-carbon px-4 py-4">
      <header className="mb-4 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h3 className="display text-fluid-lg leading-none">Hora punta</h3>
          <p className="text-fluid-xs text-ink-3">
            A qué hora encola cada piloto, UTC
          </p>
        </div>
        <p className="eyebrow" style={{ color: 'var(--color-accent)' }}>
          Pico a las {String(peakHour).padStart(2, '0')}:00
        </p>
      </header>

      <div className="flex h-24 items-end gap-[3px]">
        {buckets.map((count, hour) => (
          <div
            key={hour}
            className="group relative flex-1"
            title={`${String(hour).padStart(2, '0')}:00 · ${count} ${count === 1 ? 'piloto' : 'pilotos'}`}
          >
            <div
              className="w-full rounded-sm transition-colors"
              style={{
                height: `${Math.max((count / peak) * 100, count > 0 ? 8 : 2)}%`,
                background:
                  count === peak
                    ? 'var(--color-accent)'
                    : count > 0
                      ? 'var(--color-mark-blue)'
                      : 'var(--color-carbon-3)',
              }}
            />
          </div>
        ))}
      </div>

      <div className="eyebrow mt-2 flex justify-between text-ink-3">
        <span>00</span>
        <span>06</span>
        <span>12</span>
        <span>18</span>
        <span>23</span>
      </div>
    </section>
  );
}

/** One measure, ranked, with every value drawn against the leader's. */
function ChannelBoard({
  channel,
  players,
}: {
  channel: Channel;
  players: RankedPlayer[];
}) {
  const rows = useMemo(() => {
    const minimum = channel.minimumGames ?? 1;
    return players
      .filter((player) => player.totals.games >= minimum)
      .map((player) => ({ player, value: channel.pick(player) }))
      .filter((row): row is { player: RankedPlayer; value: number } =>
        row.value !== null,
      )
      .sort((a, b) => b.value - a.value)
      .slice(0, TOP_N);
  }, [channel, players]);

  const top = rows[0]?.value ?? 0;

  return (
    <section className="rounded-xl border border-line bg-carbon px-3 py-3">
      <header className="mb-3">
        <h3 className="display text-fluid-base leading-none">{channel.title}</h3>
        <p className="text-fluid-xs text-ink-3">{channel.caption}</p>
      </header>

      {rows.length === 0 ? (
        <p className="py-4 text-center text-fluid-xs text-ink-3">Sin datos.</p>
      ) : (
        <ol className="space-y-1">
          {rows.map(({ player, value }, index) => (
            <li key={player.id} className="relative">
              {/* The bar sits behind the row rather than beside it: the name
                  and the number stay on one line, and the length is read as
                  the weight of the row itself. */}
              <span
                aria-hidden
                className="absolute inset-y-0 left-0 rounded-sm"
                style={{
                  width: `${top > 0 ? Math.max((value / top) * 100, 3) : 0}%`,
                  background: channel.goodHigh
                    ? 'color-mix(in oklab, var(--color-mark-teal) 16%, transparent)'
                    : 'color-mix(in oklab, var(--color-mark-red) 16%, transparent)',
                }}
              />

              <div className="relative flex items-center gap-2 px-1.5 py-1">
                <span
                  className={classNames(
                    'tabular w-4 shrink-0 text-fluid-xs',
                    index === 0 ? 'text-ink' : 'text-ink-3',
                  )}
                >
                  {index + 1}
                </span>
                <Avatar
                  name={player.displayName}
                  iconId={player.profileIconId}
                  size={20}
                />
                <span
                  className={classNames(
                    'min-w-0 flex-1 truncate text-fluid-xs',
                    index === 0 ? 'text-ink' : 'text-ink-2',
                  )}
                  style={index === 0 ? { color: tierColor(player.rank) } : undefined}
                >
                  {player.displayName}
                </span>
                <span className="tabular shrink-0 text-fluid-xs">
                  {channel.format(value)}
                </span>
              </div>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function DuoBoard({
  duos,
  players,
}: {
  duos: Snapshot['duos'];
  players: RankedPlayer[];
}) {
  const byId = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );

  const rows = useMemo(
    () =>
      duos
        .map((duo) => ({
          a: byId.get(duo.playerA),
          b: byId.get(duo.playerB),
          games: duo.games,
          wins: duo.wins,
        }))
        .filter(
          (row): row is { a: RankedPlayer; b: RankedPlayer; games: number; wins: number } =>
            Boolean(row.a && row.b) && row.games > 0,
        )
        .sort((x, y) => y.wins / y.games - x.wins / x.games || y.games - x.games)
        .slice(0, 6),
    [duos, byId],
  );

  if (rows.length === 0) return null;

  return (
    <section className="rounded-xl border border-line bg-carbon px-4 py-4">
      <header className="mb-3">
        <h3 className="display text-fluid-lg leading-none">Equipos de dos</h3>
        <p className="text-fluid-xs text-ink-3">
          Quién encola con quién, y si les sale bien
        </p>
      </header>

      <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
        {rows.map((row) => (
          <li
            key={`${row.a.id}-${row.b.id}`}
            className="flex items-center gap-2 rounded-md border border-line bg-carbon-2 px-2.5 py-2"
          >
            <Avatar name={row.a.displayName} iconId={row.a.profileIconId} size={24} />
            <Avatar name={row.b.displayName} iconId={row.b.profileIconId} size={24} />
            <div className="min-w-0 flex-1">
              <p className="truncate text-fluid-xs text-ink-2">
                {row.a.displayName} · {row.b.displayName}
              </p>
              <p className="eyebrow text-ink-3">{row.games} juntos</p>
            </div>
            <span
              className="tabular shrink-0 text-fluid-sm"
              style={{
                color:
                  row.wins / row.games >= 0.5
                    ? 'var(--color-mark-teal)'
                    : 'var(--color-mark-red)',
              }}
            >
              {formatPercent(row.wins / row.games, 0)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

function Tile({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-carbon px-3 py-3">
      <dt className="eyebrow text-ink-3">{label}</dt>
      <dd className="tabular mt-1 text-fluid-lg leading-none">{value}</dd>
      {hint && <p className="mt-1 text-fluid-xs text-ink-3">{hint}</p>}
    </div>
  );
}
