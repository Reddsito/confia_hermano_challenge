import type { Rank, Role, Tier } from '@challenge/core/domain';
import { TIER_COLOR, formatRank, isApex, titleCase } from '@challenge/core/domain';

export { TIER_COLOR };

/**
 * Pinned Data Dragon version. Bump it after a patch to pick up new champion
 * and icon art; Riot keeps old versions online, so a stale pin degrades to
 * missing new champions rather than breaking every image.
 */
export const DDRAGON_VERSION = '15.15.1';

export function tierColor(rank: Rank | null): string {
  return rank ? TIER_COLOR[rank.tier] : 'var(--color-ink-3)';
}

export const ROLE_LABEL: Record<Role, string> = {
  TOP: 'Top',
  JUNGLE: 'Jungle',
  MID: 'Mid',
  ADC: 'Bot',
  SUPPORT: 'Support',
};

export function classNames(...values: Array<string | false | null | undefined>) {
  return values.filter(Boolean).join(' ');
}

export function formatPercent(value: number, digits = 0): string {
  return `${(value * 100).toFixed(digits)}%`;
}

export function formatSigned(value: number): string {
  return value > 0 ? `+${value}` : String(value);
}

export function profileIconUrl(iconId: number | null): string | null {
  if (iconId === null) return null;
  return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/profileicon/${iconId}.png`;
}

export function championIconUrl(championName: string): string {
  return `https://ddragon.leagueoflegends.com/cdn/${DDRAGON_VERSION}/img/champion/${championName}.png`;
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part.charAt(0).toUpperCase())
    .join('');
}

interface AvatarProps {
  name: string;
  iconId: number | null;
  size?: number;
  inGame?: boolean;
  ring?: string;
}

export function Avatar({ name, iconId, size = 40, inGame, ring }: AvatarProps) {
  const url = profileIconUrl(iconId);

  return (
    <span className="relative inline-flex shrink-0">
      <span
        className="display grid place-items-center overflow-hidden rounded-lg bg-carbon-3 text-ink-2"
        style={{
          width: size,
          height: size,
          fontSize: size * 0.34,
          boxShadow: ring
            ? `0 0 0 1.5px ${ring}, 0 0 16px -6px ${ring}`
            : '0 0 0 1px var(--color-line)',
        }}
      >
        {url ? (
          <img
            src={url}
            alt=""
            width={size}
            height={size}
            loading="lazy"
            className="h-full w-full object-cover"
          />
        ) : (
          initials(name)
        )}
      </span>
      {inGame && (
        <span
          className="live-dot absolute -right-1 -bottom-1 block h-2.5 w-2.5 rounded-full"
          style={{
            background: 'var(--color-mark-teal)',
            outline: '2px solid var(--color-carbon)',
          }}
          title="In game right now"
          aria-label="In game right now"
        />
      )}
    </span>
  );
}

export function RankBadge({ rank }: { rank: Rank | null }) {
  if (!rank) {
    return <span className="text-ink-3">Unranked</span>;
  }

  const color = TIER_COLOR[rank.tier];

  return (
    <span className="inline-flex items-center gap-2">
      <span
        aria-hidden="true"
        className="h-4 w-[3px] shrink-0 rounded-full"
        style={{ background: color, boxShadow: `0 0 10px -1px ${color}` }}
      />
      <span className="inline-flex items-baseline gap-1.5">
        <span className="display text-fluid-sm" style={{ color }}>
          {titleCase(rank.tier)}
        </span>
        {!isApex(rank.tier) && rank.division && (
          <span className="display text-fluid-xs text-ink-2">
            {rank.division}
          </span>
        )}
        <span className="tabular text-fluid-xs text-ink-3">
          {rank.leaguePoints} LP
        </span>
      </span>
      <span className="sr-only">{formatRank(rank)}</span>
    </span>
  );
}

/**
 * Win/loss split as one bar. Both sides carry a visible number, so the split
 * never rests on colour alone, and a 2px gap separates the two fills.
 */
export function WinRateBar({
  wins,
  losses,
  width = 120,
}: {
  wins: number;
  losses: number;
  width?: number;
}) {
  const total = wins + losses;
  const ratio = total === 0 ? 0 : wins / total;

  return (
    <div className="flex items-center gap-2">
      <span
        className="relative block h-1.5 overflow-hidden rounded-full bg-carbon-3"
        style={{ width }}
        role="img"
        aria-label={`${wins} wins, ${losses} losses`}
      >
        <span
          className="absolute inset-y-0 left-0 rounded-full"
          style={{
            width: `${ratio * 100}%`,
            background: 'var(--color-mark-teal)',
            boxShadow:
              '2px 0 0 0 var(--color-carbon), 0 0 12px -2px var(--color-mark-teal)',
          }}
        />
      </span>
      <span className="tabular text-fluid-xs whitespace-nowrap text-ink-2">
        {total === 0 ? '—' : formatPercent(ratio)}
      </span>
    </div>
  );
}

export function StreakPill({ streak }: { streak: number }) {
  if (streak === 0) return <span className="text-ink-3">—</span>;

  const isWin = streak > 0;
  const color = isWin ? 'var(--color-mark-teal)' : 'var(--color-mark-red)';

  return (
    <span
      className="tabular inline-flex items-center rounded px-1.5 py-0.5 text-[0.7rem] font-semibold"
      style={{
        color,
        background: `color-mix(in oklab, ${color} 14%, transparent)`,
        boxShadow: `inset 0 0 0 1px color-mix(in oklab, ${color} 30%, transparent)`,
      }}
      title={`${Math.abs(streak)} ${isWin ? 'wins' : 'losses'} in a row`}
    >
      {Math.abs(streak)}
      {isWin ? 'W' : 'L'}
    </span>
  );
}

/**
 * Recent form as a cumulative walk: each win steps up, each loss steps down.
 * Shape carries the story — a flat line is a plateau, a staircase is a run.
 */
export function FormSparkline({
  results,
  width = 76,
  height = 26,
}: {
  results: boolean[];
  width?: number;
  height?: number;
}) {
  const chronological = [...results].reverse().slice(-15);
  if (chronological.length < 2) {
    return <span className="text-fluid-xs text-ink-3">—</span>;
  }

  let running = 0;
  const walk = [0, ...chronological.map((won) => (running += won ? 1 : -1))];
  const min = Math.min(...walk);
  const max = Math.max(...walk);
  const span = Math.max(max - min, 1);
  const stepX = width / (walk.length - 1);
  const pad = 3;

  const points = walk.map((value, index) => {
    const x = index * stepX;
    const y = height - pad - ((value - min) / span) * (height - pad * 2);
    return [x, y] as const;
  });

  const path = points
    .map(([x, y], index) => `${index === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`)
    .join(' ');

  const net = walk[walk.length - 1]!;
  const color =
    net > 0
      ? 'var(--color-mark-teal)'
      : net < 0
        ? 'var(--color-mark-red)'
        : 'var(--color-ink-3)';
  const last = points[points.length - 1]!;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-label={`Recent form: ${chronological.filter(Boolean).length} wins and ${
        chronological.filter((won) => !won).length
      } losses in the last ${chronological.length} games`}
      className="overflow-visible"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ filter: `drop-shadow(0 0 4px ${color})` }}
      />
      <circle cx={last[0]} cy={last[1]} r="2.5" fill={color} />
    </svg>
  );
}

/** Movement since the previous refresh. Arrow plus number, never colour alone. */
export function PositionDelta({
  position,
  previousPosition,
}: {
  position: number;
  previousPosition: number | null;
}) {
  if (previousPosition === null || previousPosition === position) {
    return (
      <span className="text-fluid-xs text-ink-3" title="No change">
        –
      </span>
    );
  }

  const moved = previousPosition - position;
  const up = moved > 0;
  const color = up ? 'var(--color-mark-teal)' : 'var(--color-mark-red)';

  return (
    <span
      className="tabular inline-flex items-center gap-0.5 text-[0.68rem] font-semibold"
      style={{ color }}
      title={`${up ? 'Up' : 'Down'} ${Math.abs(moved)} since the last update`}
    >
      {up ? '▲' : '▼'}
      {Math.abs(moved)}
    </span>
  );
}

export function OpggLink({ url }: { url: string }) {
  return (
    <a
      href={url}
      target="_blank"
      rel="noreferrer noopener"
      className="eyebrow inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-ink-2 transition-all hover:border-[color:var(--color-accent)] hover:text-ink"
      style={{ letterSpacing: '0.12em' }}
      title="Open on OP.GG"
    >
      OP.GG
      <svg width="9" height="9" viewBox="0 0 16 16" fill="none" aria-hidden="true">
        <path
          d="M6 3h7v7M13 3 3.5 12.5"
          stroke="currentColor"
          strokeWidth="1.8"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </a>
  );
}
