import { useMemo, useState } from 'react';

import {
  formatRank,
  formatRankShort,
  ladderPointsToRank,
  type DayDelta,
  type LpPoint,
  type RankedPlayer,
} from '@challenge/core/domain';

import { Avatar, classNames } from './ui';

/**
 * The project's validated data marks, in the order they were validated in.
 *
 * Order matters: the palette check measures adjacent pairs, so reordering these
 * invalidates the result. Eight hues in this family were tried and failed —
 * a green between the amber and the teal collapses to ΔE 2.0 under deuteranopia
 * and 11.4 even in normal vision. Five is the honest ceiling, so a sixth player
 * onward reuses a hue and is told apart by a dashed line, the legend and the
 * hover readout rather than by colour alone.
 */
const SERIES_COLORS = [
  'var(--color-mark-red)',
  'var(--color-mark-magenta)',
  'var(--color-mark-amber)',
  'var(--color-mark-teal)',
  'var(--color-mark-blue)',
] as const;

interface Series {
  playerId: string;
  name: string;
  color: string;
  dashed: boolean;
  points: Array<{ at: number; value: number }>;
}

/**
 * Colour belongs to the player, not to their position, so a leaderboard shuffle
 * or a hidden series never repaints the others. Keying on the id sorted once
 * gives every player the same hue on every render and every reload.
 */
function buildSeries(players: RankedPlayer[], lpSeries: LpPoint[]): Series[] {
  const order = [...players].sort((a, b) => a.id.localeCompare(b.id));

  return order
    .map((player, index) => ({
      playerId: player.id,
      name: player.displayName,
      color: SERIES_COLORS[index % SERIES_COLORS.length]!,
      dashed: index >= SERIES_COLORS.length,
      points: lpSeries
        .filter((point) => point.playerId === player.id)
        .map((point) => ({ at: point.at, value: point.ladderPoints }))
        .sort((a, b) => a.at - b.at),
    }))
    .filter((series) => series.points.length > 0);
}

export function EloEvolution({
  players,
  lpSeries,
}: {
  players: RankedPlayer[];
  lpSeries: LpPoint[];
}) {
  const all = useMemo(
    () => buildSeries(players, lpSeries),
    [players, lpSeries],
  );
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [hoverAt, setHoverAt] = useState<number | null>(null);
  const [asTable, setAsTable] = useState(false);

  const shown = all.filter((series) => !hidden.has(series.playerId));

  const bounds = useMemo(() => {
    const points = shown.flatMap((series) => series.points);
    if (points.length === 0) return null;

    const times = points.map((point) => point.at);
    const values = points.map((point) => point.value);
    const minAt = Math.min(...times);
    const maxAt = Math.max(...times);
    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    // A flat series would otherwise divide by zero; pad it into a readable band.
    const pad = Math.max((maxValue - minValue) * 0.15, 40);

    return {
      minAt,
      maxAt: maxAt === minAt ? minAt + 1 : maxAt,
      minValue: minValue - pad,
      maxValue: maxValue + pad,
    };
  }, [shown]);

  if (all.length === 0) {
    return (
      <Panel
        title="Evolución de elo"
        hint="Todavía no hay historial. Se llena solo a medida que suben o bajan."
      />
    );
  }

  const W = 760;
  const H = 300;
  // Left margin sized for the longest label the scale can produce ("Gran
  // Maestro"), not for the range that happens to be on screen today.
  const PAD = { top: 14, right: 16, bottom: 26, left: 68 };

  const x = (at: number) =>
    bounds
      ? PAD.left +
        ((at - bounds.minAt) / (bounds.maxAt - bounds.minAt)) *
          (W - PAD.left - PAD.right)
      : 0;
  const y = (value: number) =>
    bounds
      ? PAD.top +
        (1 - (value - bounds.minValue) / (bounds.maxValue - bounds.minValue)) *
          (H - PAD.top - PAD.bottom)
      : 0;

  /**
   * Gridlines every division rather than every tier: a whole tier is 400 points
   * wide, so a Bronze-to-Silver range would draw a single line and leave the
   * axis unreadable. Labelled with the rank a player would recognise — the
   * underlying number is a sorting device nobody has ever been.
   */
  const bands = (() => {
    if (!bounds) return [];

    const STEP = 100;
    const first = Math.ceil(bounds.minValue / STEP) * STEP;
    const lines: number[] = [];
    for (let value = first; value <= bounds.maxValue; value += STEP) {
      lines.push(value);
    }
    // Past a handful the axis turns into stripes; thin it out evenly instead.
    const every = Math.ceil(lines.length / 6);
    return lines.filter((_, index) => index % every === 0);
  })();

  const times = [...new Set(shown.flatMap((s) => s.points.map((p) => p.at)))].sort(
    (a, b) => a - b,
  );
  const nearest =
    hoverAt !== null
      ? times.reduce(
          (best, at) =>
            Math.abs(at - hoverAt) < Math.abs(best - hoverAt) ? at : best,
          times[0] ?? 0,
        )
      : null;

  return (
    <Panel
      title="Evolución de elo"
      hint="Tocá un nombre para ocultarlo. Pasá el mouse para ver los valores."
      action={
        <button
          type="button"
          onClick={() => setAsTable((value) => !value)}
          className="eyebrow rounded-full border border-line px-2.5 py-1 text-[0.6rem] text-ink-3 transition-colors hover:text-ink"
        >
          {asTable ? 'Ver gráfico' : 'Ver tabla'}
        </button>
      }
    >
      {asTable ? (
        <Table series={all} />
      ) : (
        <div className="overflow-x-auto">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="w-full min-w-[520px]"
            role="img"
            aria-label="Evolución del elo de cada jugador a lo largo del tiempo"
            onMouseLeave={() => setHoverAt(null)}
            onMouseMove={(event) => {
              const rect = event.currentTarget.getBoundingClientRect();
              const ratio = (event.clientX - rect.left) / rect.width;
              if (!bounds) return;
              setHoverAt(
                bounds.minAt +
                  ((ratio * W - PAD.left) / (W - PAD.left - PAD.right)) *
                    (bounds.maxAt - bounds.minAt),
              );
            }}
          >
            {bands.map((value) => (
              <g key={value}>
                <line
                  x1={PAD.left}
                  x2={W - PAD.right}
                  y1={y(value)}
                  y2={y(value)}
                  stroke="var(--color-line)"
                  strokeDasharray="2 4"
                />
                <text
                  x={PAD.left - 6}
                  y={y(value) + 3}
                  textAnchor="end"
                  className="fill-[var(--color-ink-3)] text-[9px]"
                >
                  {formatRankShort(ladderPointsToRank(value))}
                </text>
              </g>
            ))}

            {nearest !== null && (
              <line
                x1={x(nearest)}
                x2={x(nearest)}
                y1={PAD.top}
                y2={H - PAD.bottom}
                stroke="var(--color-line-strong)"
              />
            )}

            {shown.map((series) => (
              <g key={series.playerId}>
                <path
                  d={series.points
                    .map(
                      (point, index) =>
                        `${index === 0 ? 'M' : 'L'} ${x(point.at)} ${y(point.value)}`,
                    )
                    .join(' ')}
                  fill="none"
                  stroke={series.color}
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeDasharray={series.dashed ? '6 4' : undefined}
                />
                {series.points.map((point) => (
                  <circle
                    key={point.at}
                    cx={x(point.at)}
                    cy={y(point.value)}
                    r={nearest === point.at ? 5 : 3}
                    fill={series.color}
                    stroke="var(--color-carbon)"
                    strokeWidth={2}
                  />
                ))}
                {/* Direct labels only while the chart is legible enough for them. */}
                {shown.length <= 4 &&
                  series.points.length > 0 &&
                  (() => {
                    const last = series.points[series.points.length - 1]!;
                    // The last sample sits on the right edge whenever a player
                    // updated most recently, so a label drawn outward would fall
                    // off the viewBox. Flip it inward instead of clipping it.
                    const flip = x(last.at) + series.name.length * 5.5 > W - PAD.right;
                    return (
                      <text
                        x={x(last.at) + (flip ? -6 : 6)}
                        y={y(last.value) + 3}
                        textAnchor={flip ? 'end' : 'start'}
                        className="fill-[var(--color-ink-2)] text-[10px]"
                      >
                        {series.name}
                      </text>
                    );
                  })()}
              </g>
            ))}
          </svg>

          {nearest !== null && (
            <div className="mt-2 rounded-xl border border-line bg-carbon-2 p-2 text-fluid-xs">
              <p className="eyebrow text-[0.6rem] text-ink-3">
                {new Date(nearest).toLocaleString('es', {
                  day: '2-digit',
                  month: 'short',
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </p>
              <ul className="mt-1 flex flex-wrap gap-x-4 gap-y-0.5">
                {shown
                  .map((series) => ({
                    series,
                    point: series.points.find((p) => p.at === nearest),
                  }))
                  .filter((entry) => entry.point)
                  .map(({ series, point }) => (
                    <li
                      key={series.playerId}
                      className="flex items-center gap-1.5"
                    >
                      <Swatch color={series.color} dashed={series.dashed} />
                      <span className="text-ink-2">{series.name}</span>
                      <span className="tabular font-medium">
                        {formatRank(ladderPointsToRank(point!.value))}
                      </span>
                    </li>
                  ))}
              </ul>
            </div>
          )}
        </div>
      )}

      <ul className="mt-3 flex flex-wrap gap-x-3 gap-y-1.5">
        {all.map((series) => {
          const off = hidden.has(series.playerId);
          return (
            <li key={series.playerId}>
              <button
                type="button"
                aria-pressed={!off}
                onClick={() =>
                  setHidden((current) => {
                    const next = new Set(current);
                    if (!next.delete(series.playerId)) next.add(series.playerId);
                    return next;
                  })
                }
                className={classNames(
                  'flex items-center gap-1.5 text-fluid-xs transition-opacity',
                  off ? 'opacity-35' : 'opacity-100',
                )}
              >
                <Swatch color={series.color} dashed={series.dashed} />
                <span className={off ? 'line-through' : undefined}>
                  {series.name}
                </span>
              </button>
            </li>
          );
        })}
      </ul>
    </Panel>
  );
}

/** Colour plus dash, so the legend carries the same two signals as the line. */
function Swatch({ color, dashed }: { color: string; dashed: boolean }) {
  return (
    <span
      aria-hidden="true"
      className="h-0.5 w-4 shrink-0 rounded-full"
      style={
        dashed
          ? {
              backgroundImage: `repeating-linear-gradient(90deg, ${color} 0 4px, transparent 4px 7px)`,
            }
          : { background: color }
      }
    />
  );
}

function Table({ series }: { series: Series[] }) {
  const rows = series
    .map((entry) => ({
      name: entry.name,
      first: entry.points[0]!.value,
      last: entry.points[entry.points.length - 1]!.value,
      samples: entry.points.length,
    }))
    .sort((a, b) => b.last - a.last);

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-fluid-xs">
        <thead>
          <tr className="eyebrow text-left text-ink-3">
            <th className="pb-1 font-semibold">Jugador</th>
            <th className="pb-1 text-right font-semibold">Inicio</th>
            <th className="pb-1 text-right font-semibold">Ahora</th>
            <th className="pb-1 text-right font-semibold">Cambio</th>
            <th className="pb-1 text-right font-semibold">Muestras</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.name} className="border-t border-line">
              <td className="py-1">{row.name}</td>
              <td className="py-1 text-right">
                {formatRank(ladderPointsToRank(row.first))}
              </td>
              <td className="py-1 text-right">
                {formatRank(ladderPointsToRank(row.last))}
              </td>
              <td
                className="tabular py-1 text-right"
                style={{
                  color:
                    row.last - row.first >= 0
                      ? 'var(--color-mark-teal)'
                      : 'var(--color-mark-red)',
                }}
              >
                {row.last - row.first >= 0 ? '+' : ''}
                {row.last - row.first}
              </td>
              <td className="tabular py-1 text-right text-ink-3">
                {row.samples}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function BestDays({
  players,
  dailyDeltas,
}: {
  players: RankedPlayer[];
  dailyDeltas: DayDelta[];
}) {
  const [side, setSide] = useState<'up' | 'down'>('up');
  const byId = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );

  const rows = useMemo(
    () =>
      dailyDeltas
        .filter((entry) =>
          side === 'up' ? entry.delta > 0 : entry.delta < 0,
        )
        .sort((a, b) =>
          side === 'up' ? b.delta - a.delta : a.delta - b.delta,
        )
        .slice(0, 8),
    [dailyDeltas, side],
  );

  const peak = Math.max(...rows.map((row) => Math.abs(row.delta)), 1);
  const accent =
    side === 'up' ? 'var(--color-mark-teal)' : 'var(--color-mark-red)';

  return (
    <Panel
      title="Mejores días"
      hint="Quién más elo ganó o perdió en un solo día, y qué día fue."
      action={
        <span className="flex rounded-full border border-line p-0.5">
          {(
            [
              ['up', 'Subidones'],
              ['down', 'Bajones'],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              aria-pressed={side === key}
              onClick={() => setSide(key)}
              className="eyebrow rounded-full px-2.5 py-1 text-[0.6rem] transition-colors"
              style={
                side === key
                  ? { background: 'var(--color-carbon-3)', color: 'var(--color-ink)' }
                  : { color: 'var(--color-ink-3)' }
              }
            >
              {label}
            </button>
          ))}
        </span>
      }
    >
      {rows.length === 0 ? (
        <p className="text-fluid-sm text-ink-3">
          Todavía no hay {side === 'up' ? 'subidas' : 'bajadas'} registradas.
        </p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((row, index) => {
            const player = byId.get(row.playerId);
            return (
              <li key={`${row.playerId}-${row.day}`} className="flex items-center gap-2.5">
                <span className="tabular w-4 shrink-0 text-fluid-xs text-ink-3">
                  {index + 1}
                </span>

                <Avatar
                  name={player?.displayName ?? '?'}
                  iconId={player?.profileIconId ?? null}
                  size={26}
                />

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fluid-xs font-medium">
                    {player?.displayName ?? 'Jugador'}
                  </span>
                  <span className="block text-[0.65rem] text-ink-3">
                    {new Date(`${row.day}T12:00:00Z`).toLocaleDateString('es', {
                      day: '2-digit',
                      month: 'short',
                    })}
                  </span>
                  <span className="mt-1 block h-1 overflow-hidden rounded-full bg-carbon-3">
                    <span
                      className="block h-full rounded-full"
                      style={{
                        width: `${(Math.abs(row.delta) / peak) * 100}%`,
                        background: accent,
                      }}
                    />
                  </span>
                </span>

                <span
                  className="tabular shrink-0 text-fluid-sm font-semibold"
                  style={{ color: accent }}
                >
                  {row.delta > 0 ? '+' : ''}
                  {row.delta}
                </span>
              </li>
            );
          })}
        </ol>
      )}

      <p className="mt-3 text-[0.65rem] text-ink-3">
        Diferencia de elo entre el cierre de un día y el del anterior.
      </p>
    </Panel>
  );
}

function Panel({
  title,
  hint,
  action,
  children,
}: {
  title: string;
  hint: string;
  action?: React.ReactNode;
  children?: React.ReactNode;
}) {
  return (
    <section className="rounded-2xl border border-line bg-carbon p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-fluid-lg">{title}</h3>
        {action}
      </header>
      <p className="mt-1 mb-4 text-fluid-xs text-ink-3">{hint}</p>
      {children}
    </section>
  );
}
