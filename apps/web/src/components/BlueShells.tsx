import { useCallback, useEffect, useMemo, useState } from 'react';

import { MAX_HELD_SHELLS, SHELL_RULE_LABEL, type RankedPlayer } from '@challenge/core/domain';

import {
  fetchChallenges,
  fetchShells,
  loginUrl,
  throwShell,
  type ChallengeOdds,
  type SessionUser,
  type ShellsState,
} from '../lib/session';
import { Avatar, classNames, formatPercent, tierColor } from './ui';

interface BlueShellsProps {
  user: SessionUser | null;
  token: string | null;
  players: RankedPlayer[];
  onBalanceChange: () => void;
}

/** How long the wheel spins before revealing the result. */
const SPIN_MS = 2600;

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
  const [result, setResult] = useState<{ name: string; detail: string } | null>(null);
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

  const fire = async () => {
    if (!token || !target || spinning) return;

    setError(null);
    setResult(null);
    setSpinning(true);

    try {
      // The server decides the outcome before the animation starts. The wheel
      // is a reveal, not the draw — a client-side spin would be trivial to
      // re-roll from the console.
      const outcome = await throwShell(token, target);
      await new Promise((resolve) => setTimeout(resolve, SPIN_MS));
      setResult(outcome.challenge);
      await reload();
      onBalanceChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setSpinning(false);
    }
  };

  if (!user) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-carbon p-8 text-center">
        <ShellMark size={56} />
        <h2 className="display mt-4 text-fluid-lg">Blue Shells</h2>
        <p className="mt-2 text-fluid-sm text-ink-2">
          Sign in with Discord to see your shells and fire one at someone.
        </p>
        <a
          href={loginUrl()}
          className="eyebrow mt-5 inline-flex min-h-11 items-center rounded-full px-5 text-void"
          style={{ background: 'var(--color-accent)' }}
        >
          Sign in with Discord
        </a>
      </div>
    );
  }

  if (!user.playerId) {
    return (
      <div className="mx-auto max-w-md rounded-2xl border border-line bg-carbon p-8 text-center">
        <h2 className="display text-fluid-lg">Almost there</h2>
        <p className="mt-2 text-fluid-sm text-ink-2">
          You are signed in as <strong>{user.username}</strong>, but your Discord
          account is not linked to a player yet. An admin links it from the
          roster panel.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-carbon p-5">
        <div className="flex flex-wrap items-center gap-4">
          <ShellMark size={44} />
          <div>
            <p className="eyebrow text-ink-3">Your shells</p>
            <p className="tabular text-[2.25rem] leading-none font-semibold">
              {available}
              <span className="eyebrow ml-2 text-ink-3">of {MAX_HELD_SHELLS}</span>
            </p>
          </div>
          <div className="ml-auto flex gap-1.5">
            {Array.from({ length: MAX_HELD_SHELLS }, (_, index) => (
              <span
                key={index}
                className={classNames(
                  'h-3 w-3 rounded-full transition-colors',
                  index < available ? '' : 'bg-carbon-3',
                )}
                style={
                  index < available
                    ? {
                        background: 'var(--color-accent)',
                        boxShadow: '0 0 12px -2px var(--color-accent)',
                      }
                    : undefined
                }
              />
            ))}
          </div>
        </div>

        {available >= MAX_HELD_SHELLS && (
          <p className="mt-3 text-fluid-xs" style={{ color: 'var(--color-mark-amber)' }}>
            You are at the cap. Achievements stop paying out until you fire one.
          </p>
        )}

        {mine && mine.shells.length > 0 && (
          <ul className="mt-4 space-y-1.5 border-t border-line pt-3">
            {mine.shells.slice(0, 6).map((shell) => (
              <li key={shell.id} className="flex items-center gap-2 text-fluid-xs">
                <span
                  className="tabular font-semibold"
                  style={{ color: 'var(--color-accent)' }}
                >
                  +{shell.amount}
                </span>
                <span className="text-ink-2">
                  {SHELL_RULE_LABEL[shell.rule as keyof typeof SHELL_RULE_LABEL] ??
                    shell.rule}
                </span>
                <span className="truncate text-ink-3">· {shell.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-2xl border border-line bg-carbon p-5">
        <h3 className="display text-fluid-lg">Fire a shell</h3>
        <p className="mt-1 text-fluid-xs text-ink-3">
          Pick a target. The wheel decides what they have to do.
        </p>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {players
            .filter((player) => player.id !== user.playerId)
            .map((player) => {
              const selected = target === player.id;
              const accent = tierColor(player.rank);
              return (
                <li key={player.id}>
                  <button
                    type="button"
                    disabled={spinning}
                    onClick={() => setTarget(player.id)}
                    aria-pressed={selected}
                    className={classNames(
                      'flex w-full items-center gap-2.5 rounded-xl border p-2.5 text-left transition-colors disabled:opacity-50',
                      selected
                        ? 'border-[color:var(--color-accent)] bg-carbon-2'
                        : 'border-line hover:border-line-strong',
                    )}
                  >
                    <Avatar
                      name={player.displayName}
                      iconId={player.profileIconId}
                      size={32}
                      ring={accent}
                    />
                    <span className="min-w-0 flex-1 truncate text-fluid-sm">
                      {player.displayName}
                    </span>
                    <span className="tabular text-fluid-xs text-ink-3">
                      #{player.position}
                    </span>
                  </button>
                </li>
              );
            })}
        </ul>

        <button
          type="button"
          disabled={!target || available <= 0 || spinning}
          onClick={() => void fire()}
          className="eyebrow mt-4 min-h-12 w-full rounded-full px-6 text-void transition-opacity disabled:opacity-40"
          style={{ background: 'var(--color-accent)' }}
        >
          {spinning
            ? 'Spinning…'
            : available <= 0
              ? 'No shells to fire'
              : target
                ? `Fire at ${byId.get(target)?.displayName ?? ''}`
                : 'Pick a target'}
        </button>

        {error && (
          <p className="mt-3 text-fluid-xs" style={{ color: 'var(--color-mark-red)' }}>
            {error}
          </p>
        )}
      </section>

      {(spinning || result) && (
        <Wheel odds={odds} spinning={spinning} result={result} />
      )}

      <section className="rounded-2xl border border-line bg-carbon p-5">
        <h3 className="display text-fluid-lg">The wheel</h3>
        <p className="mt-1 text-fluid-xs text-ink-3">
          What can land on someone, and how likely each one is.
        </p>
        <ul className="mt-4 space-y-1.5">
          {odds.map((challenge) => (
            <li key={challenge.id} className="flex items-center gap-3">
              <span className="tabular w-12 shrink-0 text-right text-fluid-xs text-ink-2">
                {formatPercent(challenge.chance, 1)}
              </span>
              <span className="h-1.5 flex-1 overflow-hidden rounded-full bg-carbon-3">
                <span
                  className="block h-full rounded-full"
                  style={{
                    width: `${challenge.chance * 100}%`,
                    background: 'var(--color-accent)',
                  }}
                />
              </span>
              <span className="min-w-0 flex-[2] truncate text-fluid-sm">
                {challenge.name}
              </span>
            </li>
          ))}
        </ul>
      </section>

      {state && state.throws.length > 0 && (
        <section className="rounded-2xl border border-line bg-carbon p-5">
          <h3 className="display text-fluid-lg">Recent hits</h3>
          <ul className="mt-3 space-y-1.5">
            {state.throws.slice(0, 12).map((row) => (
              <li key={row.id} className="flex flex-wrap items-baseline gap-1.5 text-fluid-xs">
                <span className="text-ink-2">
                  {row.fromPlayer ? byId.get(row.fromPlayer)?.displayName : 'Someone'}
                </span>
                <span className="text-ink-3">hit</span>
                <span className="font-medium">
                  {byId.get(row.toPlayer)?.displayName ?? 'someone'}
                </span>
                <span className="text-ink-3">·</span>
                <span style={{ color: 'var(--color-accent)' }}>{row.challengeName}</span>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * The reveal. The list scrolls past while the request is in flight and stops on
 * whatever the server already decided, so the animation can never disagree with
 * the recorded outcome.
 */
function Wheel({
  odds,
  spinning,
  result,
}: {
  odds: ChallengeOdds[];
  spinning: boolean;
  result: { name: string; detail: string } | null;
}) {
  const [index, setIndex] = useState(0);

  useEffect(() => {
    if (!spinning || odds.length === 0) return;

    let delay = 60;
    let timer: ReturnType<typeof setTimeout>;

    const tick = () => {
      setIndex((current) => (current + 1) % odds.length);
      // Ease out by stretching the interval, so it visibly slows to a stop.
      delay = Math.min(delay * 1.12, 320);
      timer = setTimeout(tick, delay);
    };

    timer = setTimeout(tick, delay);
    return () => clearTimeout(timer);
  }, [spinning, odds.length]);

  const showing = result?.name ?? odds[index]?.name ?? '…';

  return (
    <section
      className="rounded-2xl border p-8 text-center"
      style={{
        borderColor: result ? 'var(--color-accent)' : 'var(--color-line)',
        background: 'var(--color-carbon)',
        boxShadow: result ? '0 0 40px -18px var(--color-accent)' : undefined,
      }}
      aria-live="polite"
    >
      <p className="eyebrow text-ink-3">{result ? 'It landed on' : 'Spinning'}</p>
      <p
        className={classNames(
          'display mt-3 text-fluid-xl leading-tight',
          !result && 'opacity-70',
        )}
        style={result ? { color: 'var(--color-accent)' } : undefined}
      >
        {showing}
      </p>
      {result?.detail && (
        <p className="mt-2 text-fluid-sm text-ink-2">{result.detail}</p>
      )}
    </section>
  );
}

/** A shell, drawn rather than imported so it inherits the accent colour. */
export function ShellMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" fill="none" aria-hidden="true">
      <path
        d="M16 4c6.6 0 12 4.6 12 10.4 0 2.6-1 4.6-2.7 6.2-1 3.4-4.6 6-9.3 6s-8.3-2.6-9.3-6C5 19 4 17 4 14.4 4 8.6 9.4 4 16 4Z"
        fill="var(--color-accent)"
        fillOpacity="0.18"
        stroke="var(--color-accent)"
        strokeWidth="1.6"
      />
      <path
        d="M16 8.5c3.6 0 6.6 2.4 6.6 5.6M11 21.5c1.4 1.2 3.1 1.8 5 1.8s3.6-.6 5-1.8"
        stroke="var(--color-accent)"
        strokeWidth="1.6"
        strokeLinecap="round"
      />
    </svg>
  );
}
