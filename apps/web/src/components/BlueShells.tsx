import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

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
const REEL_ITEM_HEIGHT = 64;
/** How many times the wheel repeats before landing, so it reads as a spin. */
const REEL_LOOPS = 7;

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
  const [landed, setLanded] = useState<{ name: string; detail: string } | null>(
    null,
  );
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

        <Reel
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

/** The signature piece: a slot reel that decelerates onto the drawn result. */
function Reel({
  odds,
  spinning,
  landed,
  targetName,
}: {
  odds: ChallengeOdds[];
  spinning: boolean;
  landed: { name: string; detail: string } | null;
  targetName: string | null;
}) {
  const [offset, setOffset] = useState(0);
  const [animating, setAnimating] = useState(false);
  const stripRef = useRef<HTMLUListElement>(null);

  // The strip repeats the wheel several times and pins the drawn result at the
  // end, so the animation is a single transition that cannot disagree with the
  // recorded outcome.
  const strip = useMemo(() => {
    if (odds.length === 0) return [] as string[];
    const looped: string[] = [];
    for (let round = 0; round < REEL_LOOPS; round += 1) {
      for (const challenge of odds) looped.push(challenge.name);
    }
    if (landed) looped.push(landed.name);
    return looped;
  }, [odds, landed]);

  useEffect(() => {
    if (!landed || strip.length === 0) {
      setAnimating(false);
      setOffset(0);
      return;
    }

    // Start from the top, then travel to the final item.
    setAnimating(false);
    setOffset(0);

    const reduced =
      typeof matchMedia !== 'undefined' &&
      matchMedia('(prefers-reduced-motion: reduce)').matches;

    const id = requestAnimationFrame(() => {
      // Someone who asked for less motion gets the answer, not the ride.
      setAnimating(!reduced);
      setOffset((strip.length - 1) * REEL_ITEM_HEIGHT);
    });
    return () => cancelAnimationFrame(id);
  }, [landed, strip.length]);

  const done = Boolean(landed) && !spinning;

  return (
    <section
      className="relative overflow-hidden rounded-2xl border bg-carbon p-5"
      style={{
        borderColor: done ? 'var(--color-accent)' : 'var(--color-line)',
        boxShadow: done ? '0 0 60px -24px var(--color-accent)' : undefined,
      }}
      aria-live="polite"
    >
      <p className="eyebrow text-ink-3">
        {done
          ? targetName
            ? `It landed on ${targetName}`
            : 'It landed'
          : spinning
            ? 'Spinning'
            : 'The wheel'}
      </p>

      <div
        className="relative mt-3 overflow-hidden"
        style={{ height: REEL_ITEM_HEIGHT }}
      >
        {strip.length === 0 ? (
          <p className="flex h-full items-center text-fluid-sm text-ink-3">
            Nothing on the wheel yet.
          </p>
        ) : (
          <ul
            ref={stripRef}
            className="absolute inset-x-0 top-0"
            style={{
              transform: `translateY(-${offset}px)`,
              transition: animating
                ? `transform ${SPIN_MS}ms cubic-bezier(0.12, 0.8, 0.15, 1)`
                : 'none',
            }}
          >
            {strip.map((name, index) => (
              <li
                key={`${name}-${index}`}
                className="display flex items-center truncate text-fluid-lg"
                style={{
                  height: REEL_ITEM_HEIGHT,
                  color:
                    done && index === strip.length - 1
                      ? 'var(--color-accent)'
                      : 'var(--color-ink-2)',
                }}
              >
                {name}
              </li>
            ))}
          </ul>
        )}

        {/* Fades the items entering and leaving the window. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              'linear-gradient(var(--color-carbon), transparent 35%, transparent 65%, var(--color-carbon))',
          }}
        />
      </div>

      <div
        className="mt-1 h-px w-full"
        style={{
          background: done
            ? 'linear-gradient(90deg, var(--color-accent), transparent 70%)'
            : 'var(--color-line)',
        }}
      />

      <p className="mt-3 min-h-[1.5rem] text-fluid-sm text-ink-2">
        {done ? landed?.detail || 'No excuses.' : ' '}
      </p>
    </section>
  );
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
