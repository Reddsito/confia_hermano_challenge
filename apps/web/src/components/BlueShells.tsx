import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  MAX_HELD_SHELLS,
  SHELL_RULE_LABEL,
  type RankedPlayer,
} from '@challenge/core/domain';

import {
  fetchChallenges,
  fetchShells,
  loginUrl,
  throwShell,
  type ChallengeOdds,
  type SessionUser,
  type ShellsState,
} from '../lib/session';
import { TierCrest } from './icons';
import { Avatar, classNames, formatPercent, tierColor } from './ui';

interface BlueShellsProps {
  user: SessionUser | null;
  token: string | null;
  players: RankedPlayer[];
  onBalanceChange: () => void;
}

const SPIN_MS = 3200;


export function BlueShells({
  user,
  token,
  players,
  onBalanceChange,
}: BlueShellsProps) {
  const [state, setState] = useState<ShellsState | null>(null);
  const [odds, setOdds] = useState<ChallengeOdds[]>([]);
  const [target, setTarget] = useState<string | null>(null);
  const [spinning, setSpinning] = useState(false);
  // The whole challenge, not just its text: two entries can share a name, and
  // the wheel has to stop on the exact one the server drew.
  const [landed, setLanded] = useState<
    { id: string; name: string; detail: string } | null
  >(null);
  const [error, setError] = useState<string | null>(null);

  const reload = useCallback(async () => {
    const [shells, challenges] = await Promise.all([
      fetchShells(),
      fetchChallenges(),
    ]);
    setState(shells);
    setOdds(challenges);
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const byId = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );
  const balances = useMemo(
    () => new Map((state?.players ?? []).map((row) => [row.playerId, row])),
    [state],
  );

  const mine = user?.playerId ? balances.get(user.playerId) : null;
  const available = mine?.available ?? 0;
  const targetPlayer = target ? byId.get(target) : null;

  const fire = async () => {
    if (!token || !target || spinning) return;

    setError(null);
    setLanded(null);
    setSpinning(true);

    try {
      // The server draws before the reel moves. A client-side spin would be a
      // re-roll away from meaningless.
      const outcome = await throwShell(token, target);
      // The wheel may be out of date if someone edited it while this page was
      // open; refresh it first so the drawn slice exists to stop on.
      setOdds(await fetchChallenges());
      setLanded(outcome.challenge);
      await new Promise((resolve) => setTimeout(resolve, SPIN_MS));
      await reload();
      onBalanceChange();
      setTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLanded(null);
    } finally {
      setSpinning(false);
    }
  };

  if (!user) return <Gate />;
  if (!user.playerId) return <Unlinked username={user.username} />;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <Inventory available={available} shells={mine?.shells ?? []} />

        <Wheel
          odds={odds}
          spinning={spinning}
          landed={landed}
          targetName={targetPlayer?.displayName ?? null}
        />
      </div>

      <section className="rounded-2xl border border-line bg-carbon p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="display text-fluid-lg">Choose a victim</h3>
          <p className="text-fluid-xs text-ink-3">
            The wheel decides what they owe.
          </p>
        </header>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {players
            .filter((player) => player.id !== user.playerId)
            .map((player) => (
              <TargetCard
                key={player.id}
                player={player}
                selected={target === player.id}
                disabled={spinning}
                onSelect={() => setTarget(player.id)}
              />
            ))}
        </ul>

        <button
          type="button"
          disabled={!target || available <= 0 || spinning}
          onClick={() => void fire()}
          className={classNames(
            'eyebrow mt-4 min-h-14 w-full rounded-2xl px-6 text-void transition-all',
            'disabled:cursor-not-allowed disabled:opacity-35',
          )}
          style={{
            background: 'var(--color-accent)',
            boxShadow:
              target && available > 0 && !spinning
                ? '0 0 40px -12px var(--color-accent)'
                : undefined,
          }}
        >
          {spinning
            ? 'Incoming…'
            : available <= 0
              ? 'No shells to fire'
              : targetPlayer
                ? `Fire at ${targetPlayer.displayName}`
                : 'Pick a victim first'}
        </button>

        {error && (
          <p
            role="alert"
            className="mt-3 text-fluid-xs"
            style={{ color: 'var(--color-mark-red)' }}
          >
            {error}
          </p>
        )}
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        <Odds odds={odds} />
        <History state={state} byId={byId} />
      </div>
    </div>
  );
}

/**
 * A real wheel: one slice per challenge, sized by its weight, spun so the drawn
 * result stops under the pointer.
 *
 * The rotation is computed from the outcome the server already picked, so the
 * wheel can never stop somewhere other than what was recorded. Slice colour
 * alternates purely so neighbours are distinguishable — the meaning is in the
 * label under the pointer, never in the shade.
 */
function Wheel({
  odds,
  spinning,
  landed,
  targetName,
}: {
  odds: ChallengeOdds[];
  spinning: boolean;
  landed: { id: string; name: string; detail: string } | null;
  targetName: string | null;
}) {
  const [rotation, setRotation] = useState(0);
  const [animating, setAnimating] = useState(false);

  const slices = useMemo(() => {
    const total = odds.reduce((sum, o) => sum + o.weight, 0) || 1;
    let angle = 0;
    return odds.map((challenge) => {
      const sweep = (challenge.weight / total) * 360;
      const slice = { challenge, start: angle, sweep, mid: angle + sweep / 2 };
      angle += sweep;
      return slice;
    });
  }, [odds]);

  useEffect(() => {
    if (!landed || slices.length === 0) return;

    const target = slices.find((s) => s.challenge.id === landed.id);
    // Nothing to point at if the entry was deleted mid-spin; the result is
    // still shown as text below.
    if (!target) return;

    const reduced =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    // Five full turns before settling, so it reads as a spin rather than a jump.
    const settle = 360 * 5 - target.mid;

    setAnimating(false);
    setRotation(0);
    const id = requestAnimationFrame(() => {
      setAnimating(!reduced);
      setRotation(reduced ? -target.mid : settle);
    });
    return () => cancelAnimationFrame(id);
  }, [landed, slices]);

  const done = Boolean(landed) && !spinning;
  const size = 260;
  const radius = size / 2 - 6;

  return (
    <section
      className="flex flex-col items-center rounded-2xl border bg-carbon p-5"
      style={{
        borderColor: done ? 'var(--color-accent)' : 'var(--color-line)',
        boxShadow: done ? '0 0 60px -24px var(--color-accent)' : undefined,
      }}
      aria-live="polite"
    >
      <p className="eyebrow text-ink-3">
        {done
          ? targetName
            ? `Le cayó a ${targetName}`
            : 'It landed'
          : spinning
            ? 'Spinning'
            : 'The wheel'}
      </p>

      <div className="relative mt-4" style={{ width: size, height: size }}>
        {/* Pointer, fixed at the top. */}
        <span
          aria-hidden="true"
          className="absolute top-0 left-1/2 z-10 -translate-x-1/2"
          style={{
            width: 0,
            height: 0,
            borderLeft: '9px solid transparent',
            borderRight: '9px solid transparent',
            borderTop: '16px solid var(--color-accent)',
            filter: 'drop-shadow(0 0 6px var(--color-accent))',
          }}
        />

        <svg
          width={size}
          height={size}
          viewBox={`0 0 ${size} ${size}`}
          style={{
            transform: `rotate(${rotation}deg)`,
            transition: animating
              ? `transform ${SPIN_MS}ms cubic-bezier(0.15, 0.75, 0.1, 1)`
              : 'none',
          }}
        >
          {slices.map((slice, index) => {
            const isLanded = done && slice.challenge.id === landed?.id;
            return (
              <path
                key={slice.challenge.id}
                d={arc(size / 2, size / 2, radius, slice.start, slice.sweep)}
                fill="var(--color-accent)"
                fillOpacity={isLanded ? 0.85 : index % 2 === 0 ? 0.22 : 0.1}
                stroke="var(--color-carbon)"
                strokeWidth="2"
              />
            );
          })}
          <circle
            cx={size / 2}
            cy={size / 2}
            r={radius * 0.3}
            fill="var(--color-carbon)"
            stroke="var(--color-line)"
            strokeWidth="2"
          />
        </svg>
      </div>

      <p
        className="display mt-4 min-h-[2rem] text-center text-fluid-lg leading-tight"
        style={done ? { color: 'var(--color-accent)' } : { opacity: 0.6 }}
      >
        {done ? landed?.name : spinning ? '…' : 'Pick a victim and fire'}
      </p>
      {done && landed?.detail && (
        <p className="mt-1 text-center text-fluid-sm text-ink-2">
          {landed.detail}
        </p>
      )}
    </section>
  );
}

/** SVG path for one slice, measured clockwise from twelve o'clock. */
function arc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  sweepDeg: number,
): string {
  // A single slice covering the whole circle cannot be drawn as an arc, since
  // its start and end points coincide.
  if (sweepDeg >= 359.9) {
    return `M ${cx} ${cy - r} A ${r} ${r} 0 1 1 ${cx - 0.01} ${cy - r} Z`;
  }

  const point = (deg: number) => {
    const rad = ((deg - 90) * Math.PI) / 180;
    return [cx + r * Math.cos(rad), cy + r * Math.sin(rad)] as const;
  };

  const [x1, y1] = point(startDeg);
  const [x2, y2] = point(startDeg + sweepDeg);
  const large = sweepDeg > 180 ? 1 : 0;

  return `M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`;
}

function Inventory({
  available,
  shells,
}: {
  available: number;
  shells: Array<{ id: string; rule: string; amount: number; detail: string }>;
}) {
  const full = available >= MAX_HELD_SHELLS;

  return (
    <section className="rounded-2xl border border-line bg-carbon p-5">
      <p className="eyebrow text-ink-3">Your arsenal</p>

      <div className="mt-3 flex items-center gap-2">
        {Array.from({ length: MAX_HELD_SHELLS }, (_, index) => (
          <ShellMark key={index} size={44} filled={index < available} />
        ))}
        <span className="tabular ml-auto text-[2.5rem] leading-none font-semibold">
          {available}
          <span className="eyebrow ml-1 text-ink-3">/{MAX_HELD_SHELLS}</span>
        </span>
      </div>

      <p
        className="mt-3 text-fluid-xs"
        style={{ color: full ? 'var(--color-mark-amber)' : 'var(--color-ink-3)' }}
      >
        {full
          ? 'Loaded. Nothing else counts until you fire it.'
          : 'Empty. Earn one, or take it from someone you beat.'}
      </p>
      <p className="mt-1 text-fluid-xs text-ink-3">
        Beat another participant in a game and their shell is yours — or gone,
        if you were already loaded.
      </p>

      {shells.length > 0 && (
        <ul className="mt-4 space-y-2 border-t border-line pt-3">
          {shells.slice(0, 5).map((shell) => (
            <li key={shell.id} className="flex items-start gap-2">
              <span
                className="tabular mt-px text-fluid-xs font-semibold"
                style={{ color: 'var(--color-accent)' }}
              >
                +{shell.amount}
              </span>
              <span className="min-w-0">
                <span className="block truncate text-fluid-xs">
                  {SHELL_RULE_LABEL[shell.rule as keyof typeof SHELL_RULE_LABEL] ??
                    'Adjustment'}
                </span>
                <span className="block truncate text-[0.68rem] text-ink-3">
                  {shell.detail}
                </span>
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function TargetCard({
  player,
  selected,
  disabled,
  onSelect,
}: {
  player: RankedPlayer;
  selected: boolean;
  disabled: boolean;
  onSelect: () => void;
}) {
  const accent = tierColor(player.rank);

  return (
    <li>
      <button
        type="button"
        disabled={disabled}
        onClick={onSelect}
        aria-pressed={selected}
        className={classNames(
          'flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all',
          'disabled:cursor-not-allowed disabled:opacity-40',
          selected ? 'bg-carbon-2' : 'border-line hover:border-line-strong',
        )}
        style={
          selected
            ? {
                borderColor: 'var(--color-accent)',
                boxShadow: '0 0 26px -14px var(--color-accent)',
              }
            : undefined
        }
      >
        <Avatar
          name={player.displayName}
          iconId={player.profileIconId}
          size={38}
          ring={accent}
          inGame={player.inGame}
        />

        <span className="min-w-0 flex-1">
          <span className="display block truncate text-fluid-sm">
            {player.displayName}
          </span>
          <span className="block truncate text-[0.68rem] text-ink-3">
            #{player.position} · {player.totals.wins}W {player.totals.losses}L
          </span>
        </span>

        <TierCrest rank={player.rank} size={26} />
      </button>
    </li>
  );
}

function Odds({ odds }: { odds: ChallengeOdds[] }) {
  const highest = Math.max(...odds.map((challenge) => challenge.chance), 0.01);

  return (
    <section className="rounded-2xl border border-line bg-carbon p-5">
      <h3 className="display text-fluid-lg">What can land</h3>
      <p className="mt-1 text-fluid-xs text-ink-3">
        Odds are derived from the weights set in the panel.
      </p>

      <ul className="mt-4 space-y-2.5">
        {odds.map((challenge) => (
          <li key={challenge.id}>
            <div className="flex items-baseline gap-2">
              <span className="tabular w-11 shrink-0 text-fluid-xs font-medium">
                {formatPercent(challenge.chance, 1)}
              </span>
              <span className="min-w-0 flex-1 truncate text-fluid-sm">
                {challenge.name}
              </span>
            </div>
            <div className="mt-1 ml-[3.25rem] h-1 overflow-hidden rounded-full bg-carbon-3">
              <div
                className="h-full rounded-full"
                style={{
                  // Scaled against the most likely entry so small differences
                  // stay visible instead of all collapsing near zero.
                  width: `${(challenge.chance / highest) * 100}%`,
                  background: 'var(--color-accent)',
                  boxShadow: '0 0 10px -2px var(--color-accent)',
                }}
              />
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

function History({
  state,
  byId,
}: {
  state: ShellsState | null;
  byId: Map<string, RankedPlayer>;
}) {
  const throws = state?.throws ?? [];

  return (
    <section className="rounded-2xl border border-line bg-carbon p-5">
      <h3 className="display text-fluid-lg">Recent hits</h3>

      {throws.length === 0 ? (
        <p className="mt-3 text-fluid-sm text-ink-3">
          Nobody has been hit yet. Someone has to go first.
        </p>
      ) : (
        <ol className="mt-4 space-y-3">
          {throws.slice(0, 8).map((row) => (
            <li key={row.id} className="flex gap-3">
              <span
                aria-hidden="true"
                className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: 'var(--color-accent)',
                  boxShadow: '0 0 8px 0 var(--color-accent)',
                }}
              />
              <span className="min-w-0">
                <span className="block text-fluid-sm">
                  <span className="text-ink-2">
                    {row.fromPlayer
                      ? (byId.get(row.fromPlayer)?.displayName ?? 'Someone')
                      : 'Someone'}
                  </span>
                  <span className="text-ink-3"> hit </span>
                  <span className="font-medium">
                    {byId.get(row.toPlayer)?.displayName ?? 'someone'}
                  </span>
                </span>
                <span
                  className="block truncate text-[0.72rem]"
                  style={{ color: 'var(--color-accent)' }}
                >
                  {row.challengeName}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}

function Gate() {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-carbon p-8 text-center">
      <span className="inline-flex">
        <ShellMark size={64} filled />
      </span>
      <h2 className="display mt-4 text-fluid-lg">Blue Shells</h2>
      <p className="mt-2 text-fluid-sm text-ink-2">
        Earn them by doing something absurd in a game. Spend them making someone
        else suffer.
      </p>
      <a
        href={loginUrl()}
        className="eyebrow mt-6 inline-flex min-h-12 items-center rounded-full px-6 text-void"
        style={{
          background: 'var(--color-accent)',
          boxShadow: '0 0 36px -14px var(--color-accent)',
        }}
      >
        Sign in with Discord
      </a>
    </div>
  );
}

function Unlinked({ username }: { username: string }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-carbon p-8 text-center">
      <ShellMark size={48} />
      <h2 className="display mt-4 text-fluid-lg">Almost there</h2>
      <p className="mt-2 text-fluid-sm text-ink-2">
        Signed in as <strong>{username}</strong>, but this Discord account is not
        linked to a player yet. An admin does that from the roster panel.
      </p>
    </div>
  );
}

/** Drawn rather than imported, so it inherits the accent colour and can dim. */
export function ShellMark({
  size = 24,
  filled = false,
}: {
  size?: number;
  filled?: boolean;
}) {
  const colour = filled ? 'var(--color-accent)' : 'var(--color-line-strong)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={
        filled
          ? { filter: 'drop-shadow(0 0 8px color-mix(in oklab, var(--color-accent) 60%, transparent))' }
          : undefined
      }
    >
      <path
        d="M16 3.5c7 0 12.6 4.9 12.6 11 0 2.8-1.1 4.9-2.9 6.6-1.1 3.6-4.9 6.4-9.7 6.4s-8.6-2.8-9.7-6.4C4.5 19.4 3.4 17.3 3.4 14.5c0-6.1 5.6-11 12.6-11Z"
        fill={colour}
        fillOpacity={filled ? 0.2 : 0.08}
        stroke={colour}
        strokeWidth="1.7"
      />
      <path
        d="M16 8c3.8 0 7 2.6 7 6"
        stroke={colour}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M10.4 22.6c1.6 1.2 3.5 1.9 5.6 1.9s4-.7 5.6-1.9"
        stroke={colour}
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <path
        d="M16 12.5v4M13.5 14.5h5"
        stroke={colour}
        strokeWidth="1.5"
        strokeLinecap="round"
        opacity={filled ? 0.9 : 0.5}
      />
    </svg>
  );
}
