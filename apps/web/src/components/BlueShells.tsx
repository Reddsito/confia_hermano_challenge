import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  MAX_HELD_SHELLS,
  SHELL_RULES,
  SHELL_RULE_AWARD,
  SHELL_RULE_LABEL,
  COIN_WALLET_CAP,
  SHELL_PRICE_COINS,
  SPECTATOR_DAILY_GRANT,
  type RankedPlayer,
} from '@challenge/core/domain';

import {
  fetchChallenges,
  fetchChampionIndex,
  fetchChampionPool,
  fetchItemIndex,
  fetchReceived,
  fetchRuneIndex,
  fetchShells,
  loginUrl,
  previewRoll,
  rerollThrow,
  throwShell,
  type ChallengeOdds,
  type ChampionInfo,
  type ItemInfo,
  type ReceivedThrow,
  type RuneOption,
  type SessionUser,
  type ShellPayload,
  type ShellsState,
} from '../lib/session';
import { TierCrest } from './icons';
import { CoinShop } from './CoinShop';
import { PayloadView } from './ShellRoll';
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

  // What the landed challenge rolled, if it rolls anything, plus the throw it
  // belongs to — the reroll needs the id, not just the result.
  const [rolled, setRolled] = useState<{
    throwId: string;
    payload: ShellPayload;
    rerollsLeft: number;
  } | null>(null);
  const [pool, setPool] = useState<number[]>([]);
  const [rerolling, setRerolling] = useState(false);
  // Admin only: naming the challenge instead of spinning for it, so one entry
  // can be tested on purpose rather than by firing until it comes up.
  const [forced, setForced] = useState<string | null>(null);

  // Static reference data: champion art and rune names never change while the
  // page is open, so they are fetched once rather than per roll.
  const [champions, setChampions] = useState<Map<number, ChampionInfo>>(new Map());
  const [runes, setRunes] = useState<Map<number, RuneOption>>(new Map());
  const [items, setItems] = useState<Map<number, ItemInfo>>(new Map());
  const [received, setReceived] = useState<ReceivedThrow[]>([]);

  const reload = useCallback(async () => {
    const [shells, challenges] = await Promise.all([
      fetchShells(),
      fetchChallenges(),
    ]);
    setState(shells);
    setOdds(challenges);
  }, []);

  const reloadReceived = useCallback(async () => {
    if (!token) return;
    setReceived(await fetchReceived(token));
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload]);

  useEffect(() => {
    void reloadReceived();
  }, [reloadReceived]);

  useEffect(() => {
    void (async () => {
      const [championIndex, runeIndex, itemIndex] = await Promise.all([
        fetchChampionIndex(),
        fetchRuneIndex(),
        fetchItemIndex(),
      ]);
      setChampions(championIndex);
      setRunes(runeIndex);
      setItems(itemIndex);
    })();
  }, []);

  // Warmed as soon as a target is picked, so the reel already has real
  // candidates to flick through by the time the wheel stops.
  useEffect(() => {
    if (!target) {
      setPool([]);
      return;
    }
    void fetchChampionPool(target).then(setPool);
  }, [target]);

  const byId = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );
  const balances = useMemo(
    () => new Map((state?.players ?? []).map((row) => [row.playerId, row])),
    [state],
  );

  const mine = user?.playerId ? balances.get(user.playerId) : null;
  // Read off the wallet, not the roster row: it is the only balance a spectator
  // has, and for a player it is the same figure with the wagers folded in.
  const available = user?.wallet?.available ?? mine?.available ?? 0;
  const ceiling = user?.wallet?.ceiling ?? MAX_HELD_SHELLS;
  const isSpectator = user?.isSpectator ?? false;
  const targetPlayer = target ? byId.get(target) : null;

  const fire = async () => {
    if (!token || !target || spinning) return;

    setError(null);
    setLanded(null);
    setRolled(null);
    setSpinning(true);

    try {
      // The server draws before the reel moves. A client-side spin would be a
      // re-roll away from meaningless.
      const outcome = await throwShell(token, target, forced ?? undefined);
      // The wheel may be out of date if someone edited it while this page was
      // open; refresh it first so the drawn slice exists to stop on.
      setOdds(await fetchChallenges());
      setLanded(outcome.challenge);
      await new Promise((resolve) => setTimeout(resolve, SPIN_MS));

      // Revealed only after the wheel has stopped: showing the champion while
      // the wheel is still turning gives the result away before its own spin.
      if (outcome.throw.payload) {
        setRolled({
          throwId: outcome.throw.id,
          payload: outcome.throw.payload,
          rerollsLeft: outcome.rerollsLeft,
        });
      }

      await reload();
      await reloadReceived();
      onBalanceChange();
      setTarget(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
      setLanded(null);
    } finally {
      setSpinning(false);
    }
  };

  const reroll = async () => {
    if (!token || !rolled || rerolling || rolled.rerollsLeft <= 0) return;

    setRerolling(true);
    setError(null);

    try {
      const outcome = await rerollThrow(token, rolled.throwId, 'No lo tiene');
      setRolled({
        throwId: rolled.throwId,
        payload: { kind: 'RANDOM_CHAMPION', championId: outcome.championId },
        rerollsLeft: outcome.rerollsLeft,
      });
      await reloadReceived();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setRerolling(false);
    }
  };

  if (!user) return <Gate />;
  // Spectators have no roster entry by design — that is the whole role. Only
  // somebody who is meant to be playing can be missing a link.
  if (!user.playerId && !user.isSpectator) {
    return <Unlinked username={user.username} />;
  }

  return (
    <div className="space-y-4">
      {/*
        What you owe comes first. It is the one thing on this page that is
        actionable, and it used to sit below the wheel where it was only found
        by scrolling past everything you might do to somebody else.
      */}
      {/* Nothing can ever land on a spectator, so they are not shown a card
          that would permanently read "you are all caught up". */}
      {!isSpectator && (
        <Received
          throws={received}
          champions={champions}
          runes={runes}
          items={items}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-[minmax(0,22rem)_1fr]">
        <div className="space-y-4">
          <Inventory
            available={available}
            shells={mine?.shells ?? []}
            ceiling={ceiling}
            isSpectator={isSpectator}
          />

          <CoinShop
            wallet={user.coins}
            heldShells={available}
            token={token}
            onBought={async () => {
              await reload();
              onBalanceChange();
            }}
          />
        </div>

        <Wheel
          odds={odds}
          spinning={spinning}
          landed={landed}
          targetName={targetPlayer?.displayName ?? null}
        />
      </div>

      {rolled && (
        <section className="rounded-2xl border border-line bg-carbon p-5">
          <header className="flex flex-wrap items-baseline justify-between gap-3">
            <h3 className="display text-fluid-lg">
              {rolled.payload.kind === 'RANDOM_CHAMPION'
                ? 'Le tocó'
                : 'Con estas runas'}
            </h3>

            {rolled.payload.kind === 'RANDOM_CHAMPION' && (
              <div className="flex items-center gap-3">
                <p className="text-fluid-xs text-ink-3">
                  {rolled.rerollsLeft > 0
                    ? `Te quedan ${rolled.rerollsLeft} giros si no lo tiene`
                    : 'Sin giros: este es el definitivo'}
                </p>
                <button
                  type="button"
                  disabled={rolled.rerollsLeft <= 0 || rerolling}
                  onClick={() => void reroll()}
                  className={classNames(
                    'eyebrow min-h-11 rounded-xl border border-line px-4 transition-all',
                    'disabled:cursor-not-allowed disabled:opacity-35',
                  )}
                >
                  {rerolling ? 'Girando…' : 'No lo tiene, girar'}
                </button>
              </div>
            )}
          </header>

          <div className="mt-4">
            <PayloadView
              // Keyed by the result so a reroll remounts the reel and replays
              // the spin, instead of silently swapping the icon underneath.
              key={
                rolled.payload.kind === 'RANDOM_CHAMPION'
                  ? rolled.payload.championId
                  : 'runes'
              }
              payload={rolled.payload}
              champions={champions}
              runes={runes}
              items={items}
              pool={pool}
              animate
            />
          </div>
        </section>
      )}

      <section className="rounded-2xl border border-line bg-carbon p-5">
        <header className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="display text-fluid-lg">Elegí una víctima</h3>
          <p className="text-fluid-xs text-ink-3">
            La ruleta decide qué te deben.
          </p>
        </header>

        <ul className="mt-4 grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {players
            // Admins keep themselves on the list: firing at yourself is the
            // only way to walk the whole flow without making someone else owe
            // a game. It still costs a shell.
            .filter((player) => user.isAdmin || player.id !== user.playerId)
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

        {user.isAdmin && (
          <label className="mt-4 block">
            <span className="eyebrow text-ink-3">
              Forzar reto (solo admin) — vacío gira la ruleta
            </span>
            <select
              value={forced ?? ''}
              onChange={(event) => setForced(event.target.value || null)}
              disabled={spinning}
              className="mt-1 min-h-11 w-full rounded-xl border border-line bg-void px-3 text-fluid-sm"
            >
              <option value="">Que decida la ruleta</option>
              {odds.map((challenge) => (
                <option key={challenge.id} value={challenge.id}>
                  {challenge.name}
                </option>
              ))}
            </select>
          </label>
        )}

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
            ? 'Ahí va…'
            : available <= 0
              ? 'No tenés conchas para tirar'
              : targetPlayer
                ? `Tirarle a ${targetPlayer.displayName}`
                : 'Elegí una víctima primero'}
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

      {user.isAdmin && (
        <TestBench
          token={token}
          targetId={target ?? user.playerId}
          champions={champions}
          runes={runes}
          items={items}
          pool={pool}
        />
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Odds odds={odds} />
        <History state={state} byId={byId} />
      </div>
    </div>
  );
}

/**
 * Admin-only bench for seeing what a roll produces.
 *
 * Nothing here is stored and no shell is spent, so it can be hammered while
 * checking how a rune page or a champion reel renders. Firing for real is still
 * the button above.
 */
function TestBench({
  token,
  targetId,
  champions,
  runes,
  items,
  pool,
}: {
  token: string | null;
  targetId: string | null;
  champions: Map<number, ChampionInfo>;
  runes: Map<number, RuneOption>;
  items: Map<number, ItemInfo>;
  pool: number[];
}) {
  const [preview, setPreview] = useState<ShellPayload | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const roll = async (
    kind: 'RANDOM_CHAMPION' | 'RANDOM_RUNES' | 'RANDOM_BUILD',
  ) => {
    if (!token || !targetId || busy) return;

    setBusy(true);
    setError(null);
    try {
      setPreview(await previewRoll(token, targetId, kind));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="rounded-2xl border border-dashed border-line bg-carbon p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-fluid-lg">Banco de pruebas</h3>
        <p className="text-fluid-xs text-ink-3">
          No gasta conchas ni le debe nada a nadie
        </p>
      </header>

      <div className="mt-4 flex flex-wrap gap-2">
        <button
          type="button"
          disabled={busy || !targetId}
          onClick={() => void roll('RANDOM_CHAMPION')}
          className="eyebrow min-h-11 rounded-xl border border-line px-4 transition-colors hover:text-ink disabled:opacity-35"
        >
          Probar campeón
        </button>
        <button
          type="button"
          disabled={busy || !targetId}
          onClick={() => void roll('RANDOM_RUNES')}
          className="eyebrow min-h-11 rounded-xl border border-line px-4 transition-colors hover:text-ink disabled:opacity-35"
        >
          Probar runas
        </button>
        <button
          type="button"
          disabled={busy || !targetId}
          onClick={() => void roll('RANDOM_BUILD')}
          className="eyebrow min-h-11 rounded-xl border border-line px-4 transition-colors hover:text-ink disabled:opacity-35"
        >
          Probar build
        </button>
      </div>

      {error && (
        <p
          role="alert"
          className="mt-3 text-fluid-xs"
          style={{ color: 'var(--color-mark-red)' }}
        >
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-4">
          <PayloadView
            key={
              preview.kind === 'RANDOM_CHAMPION'
                ? preview.championId
                : preview.kind === 'RANDOM_BUILD'
                  ? preview.itemIds.join('-')
                  : 'runes'
            }
            payload={preview}
            champions={champions}
            runes={runes}
            items={items}
            pool={pool}
            animate
          />
        </div>
      )}
    </section>
  );
}

/**
 * What has been fired at you, newest first, with the full spin history of each.
 *
 * The history is the point: a champion that was rerolled twice shows all three
 * results, so "he said he didn't own it" is a record rather than a claim.
 */
function Received({
  throws,
  champions,
  runes,
  items,
}: {
  throws: ReceivedThrow[];
  champions: Map<number, ChampionInfo>;
  runes: Map<number, RuneOption>;
  items: Map<number, ItemInfo>;
}) {
  const [open, setOpen] = useState<string | null>(null);
  // Settled ones are history; what you still owe is the reason to look.
  const [showDone, setShowDone] = useState(false);

  const pending = throws.filter((record) => !record.completedAt);
  const done = throws.filter((record) => record.completedAt);
  const shown = showDone ? throws : pending;

  // The oldest debt is the one the next game pays off, so it leads.
  const next = pending[pending.length - 1] ?? null;

  if (throws.length === 0) {
    return (
      <section className="rounded-2xl border border-line bg-carbon p-5">
        <h3 className="display text-fluid-lg">Lo que te deben cumplir</h3>
        <p className="mt-2 text-fluid-xs text-ink-3">
          Todavía nadie te tiró nada. Disfrutalo.
        </p>
      </section>
    );
  }

  return (
    <section
      className="overflow-hidden rounded-2xl border bg-carbon"
      style={{
        borderColor: pending.length > 0 ? 'var(--color-accent)' : 'var(--color-line)',
      }}
    >
      <header
        className="flex flex-wrap items-center justify-between gap-3 px-5 py-4"
        style={{
          background:
            pending.length > 0
              ? 'color-mix(in oklab, var(--color-accent) 12%, transparent)'
              : undefined,
        }}
      >
        <div>
          <h3 className="display text-fluid-lg">
            {pending.length > 0 ? 'Tenés retos pendientes' : 'Estás al día'}
          </h3>
          <p className="text-fluid-xs text-ink-3">
            {pending.length > 0
              ? `${pending.length} ${pending.length === 1 ? 'reto' : 'retos'} · se paga uno por partida`
              : 'Cumpliste todo lo que te tiraron'}
          </p>
        </div>

        {done.length > 0 && (
          <button
            type="button"
            onClick={() => setShowDone(!showDone)}
            className="eyebrow min-h-10 rounded-full border border-line px-4 text-ink-3 transition-colors hover:text-ink"
          >
            {showDone ? 'Ocultar cumplidos' : `Ver cumplidos (${done.length})`}
          </button>
        )}
      </header>

      {/*
        The next one to pay is shown open, because a debt behind a click is a
        debt you can claim you never saw.
      */}
      {next && (
        <div className="border-t border-line px-5 py-4">
          <p className="eyebrow text-ink-3">Lo próximo que jugás paga esto</p>
          <p className="display mt-1 text-fluid-lg">{next.challengeName}</p>
          <p className="text-fluid-xs text-ink-3">
            Te la tiró {next.fromName ?? 'alguien'}
          </p>

          {next.payload && (
            <div className="mt-4">
              <PayloadView
                payload={next.payload}
                champions={champions}
                runes={runes}
                items={items}
              />
            </div>
          )}
        </div>
      )}

      <ul className="divide-y divide-line border-t border-line">
        {shown
          .filter((record) => record.id !== next?.id)
          .map((record) => {
            const expanded = open === record.id;

            return (
              <li key={record.id}>
                <button
                  type="button"
                  onClick={() => setOpen(expanded ? null : record.id)}
                  aria-expanded={expanded}
                  className="flex min-h-14 w-full items-center gap-3 px-5 py-3 text-left transition-colors hover:bg-carbon-3"
                >
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{
                      background: record.completedAt
                        ? 'var(--color-line)'
                        : 'var(--color-accent)',
                    }}
                    aria-hidden
                  />

                  <span className="min-w-0 flex-1">
                    <span
                      className={classNames(
                        'block truncate text-fluid-sm',
                        Boolean(record.completedAt) && 'text-ink-3 line-through',
                      )}
                    >
                      {record.challengeName}
                    </span>
                    <span className="block text-fluid-xs text-ink-3">
                      {record.fromName ?? 'Alguien'} ·{' '}
                      {new Date(record.thrownAt).toLocaleDateString('es-AR')}
                    </span>
                  </span>

                  {record.payload?.kind === 'RANDOM_CHAMPION' && (
                    <img
                      src={champions.get(record.payload.championId)?.icon}
                      alt=""
                      width={30}
                      height={30}
                      className="shrink-0 rounded-md"
                      aria-hidden
                    />
                  )}
                </button>

                {expanded && (
                  <div className="space-y-4 px-5 pb-4">
                    <PayloadView
                      payload={record.payload}
                      champions={champions}
                      runes={runes}
                      items={items}
                    />

                    {record.rolls.length > 1 && (
                      <div>
                        <p className="eyebrow text-ink-3">Giros</p>
                        <ol className="mt-2 space-y-1">
                          {record.rolls.map((roll, index) => (
                            <li
                              key={roll.id}
                              className="text-fluid-xs text-ink-2"
                            >
                              {index + 1}.{' '}
                              {roll.payload?.kind === 'RANDOM_CHAMPION'
                                ? (champions.get(roll.payload.championId)?.name ??
                                  `#${roll.payload.championId}`)
                                : 'Página de runas'}
                              {roll.reason && ` — ${roll.reason}`}
                            </li>
                          ))}
                        </ol>
                      </div>
                    )}
                  </div>
                )}
              </li>
            );
          })}
      </ul>
    </section>
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
            : 'Cayó'
          : spinning
            ? 'Girando'
            : 'La ruleta'}
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
        {done ? landed?.name : spinning ? '…' : 'Elegí una víctima y tirá'}
      </p>
      {done && landed?.detail && (
        <p className="mt-1 text-center text-fluid-sm text-ink-2">
          {landed.detail}
        </p>
      )}
    </section>
  );
}

export const COIN_GOLD = '#f2c94c';

/**
 * One moneda. A struck coin rather than a flat dot, so it reads as currency
 * next to the shell and not as another progress pip.
 */
export function CoinMark({
  size = 16,
  filled = false,
}: {
  size?: number;
  filled?: boolean;
}) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      aria-hidden="true"
      style={
        filled
          ? {
              filter: `drop-shadow(0 0 5px color-mix(in oklab, ${COIN_GOLD} 55%, transparent))`,
            }
          : undefined
      }
    >
      <circle
        cx="16"
        cy="16"
        r="13"
        fill={filled ? COIN_GOLD : 'transparent'}
        stroke={filled ? COIN_GOLD : 'var(--color-line-strong)'}
        strokeWidth="2"
      />
      {/* The inner ring only shows on a struck coin; an empty slot stays a
          plain outline so a full rack is legible at a glance. */}
      {filled && (
        <circle
          cx="16"
          cy="16"
          r="7.5"
          fill="none"
          stroke="color-mix(in oklab, #05070a 45%, transparent)"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}

/**
 * The coin rack: fifteen of them, filled up to what is held.
 *
 * Fifteen marks is a lot, so they are drawn small and allowed to wrap. Anything
 * a spectator wins above the cap is appended past the rack rather than dropped,
 * since exceeding it is the one thing their winnings can do.
 */
export function CoinRack({ coins, cap }: { coins: number; cap: number }) {
  return (
    <span className="inline-flex flex-wrap items-center gap-1" aria-hidden="true">
      {Array.from({ length: Math.max(cap, coins) }, (_, index) => (
        <CoinMark key={index} size={14} filled={index < coins} />
      ))}
    </span>
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
  ceiling,
  isSpectator,
}: {
  available: number;
  shells: Array<{ id: string; rule: string; amount: number; detail: string }>;
  ceiling: number;
  isSpectator: boolean;
}) {
  const full = available >= ceiling;
  // Newest first, straight from the query, so this is the shell most recently
  // earned — the reason the counter above moved.
  const latest = shells[0] ?? null;

  return (
    <section className="rounded-2xl border border-line bg-carbon p-5">
      <p className="eyebrow text-ink-3">Tu arsenal</p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        {Array.from({ length: ceiling }, (_, index) => (
          <ShellMark key={index} size={36} filled={index < available} />
        ))}
        <span className="tabular ml-auto text-[2.5rem] leading-none font-semibold">
          {available}
          <span className="eyebrow ml-1 text-ink-3">/{ceiling}</span>
        </span>
      </div>

      <p
        className="mt-3 text-fluid-xs"
        style={{ color: full ? 'var(--color-mark-amber)' : 'var(--color-ink-3)' }}
      >
        {full
          ? 'Llena. Nada más cuenta hasta que tires una.'
          : available > 0
            ? `Te queda${available > 1 ? 'n' : ''} ${available} para tirar.`
            : isSpectator
              ? `Vacío. Comprá una con ${SHELL_PRICE_COINS} monedas.`
              : `Vacío. Ganá una, comprala con ${SHELL_PRICE_COINS} monedas, o robásela a alguien al que le ganes.`}
      </p>
      {isSpectator ? <EarnBetting /> : <Earn latest={latest} />}
    </section>
  );
}

/**
 * The spectator's version of the same card.
 *
 * Spectators never play, so every achievement in the list next door is
 * unreachable for them — showing it would be telling somebody to go get a
 * pentakill in a game they are not allowed to be in. Betting is their whole
 * economy, so that is what this explains.
 */
function EarnBetting() {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="eyebrow text-ink-3">Cómo conseguir más</p>

      <ul className="mt-2 space-y-1.5">
        {[
          `Ganás ${SPECTATOR_DAILY_GRANT} monedas por día, hasta llegar a ${COIN_WALLET_CAP}.`,
          'Apostás a las partidas de los demás, en la pestaña En vivo.',
          'Ganando apuestas sí podés pasarte del tope: es tu única forma de despegar.',
          `Con ${SHELL_PRICE_COINS} monedas comprás una concha azul.`,
        ].map((line) => (
          <li key={line} className="flex items-baseline gap-2 text-fluid-xs">
            <span aria-hidden="true" className="shrink-0 text-ink-3">
              ›
            </span>
            <span>{line}</span>
          </li>
        ))}
      </ul>

      <p className="mt-3 text-[0.68rem] text-ink-3">
        No jugás, así que las metas de partida no te aplican. Las conchas que
        ganes las podés tirar a cualquiera del torneo.
      </p>
    </div>
  );
}

/**
 * Every way to earn a shell, always all of them. It lives inside the arsenal
 * card, which is where the player is told to go earn one — listing the rules
 * anywhere else leaves eight of the nine invisible until they happen by luck.
 *
 * Only the most recently earned rule is marked, and it is marked as an event
 * rather than as progress: every rule can pay again, so a permanent tick would
 * claim a rule is spent when it is not.
 */
function Earn({
  latest,
}: {
  latest: { rule: string; amount: number; detail: string } | null;
}) {
  return (
    <div className="mt-4 border-t border-line pt-3">
      <p className="eyebrow text-ink-3">Cómo ganar una</p>

      <ul className="mt-2 space-y-1">
        {SHELL_RULES.map((rule) => {
          const isLatest = latest?.rule === rule;

          return (
            <li key={rule} className="flex items-baseline gap-2">
              <span
                className="tabular shrink-0 text-fluid-xs font-semibold"
                style={{ color: 'var(--color-accent)' }}
              >
                +{SHELL_RULE_AWARD[rule]}
              </span>
              <span
                className="min-w-0 text-fluid-xs"
                style={
                  isLatest ? { color: 'var(--color-accent)' } : undefined
                }
              >
                {SHELL_RULE_LABEL[rule]}
                {isLatest && (
                  <span className="block text-[0.68rem] text-ink-3">
                    ← la última que ganaste · {latest.detail}
                  </span>
                )}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="mt-3 text-[0.68rem] text-ink-3">
        Una concha por partida: si cumplís varias, cobrás solo la más difícil.
        Todas se pueden volver a cumplir, y también podés robarle la concha a
        otro participante ganándole una partida.
      </p>
    </div>
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
      <h3 className="display text-fluid-lg">Qué puede caer</h3>
      <p className="mt-1 text-fluid-xs text-ink-3">
        Las probabilidades salen de los pesos configurados en el panel.
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
      <h3 className="display text-fluid-lg">Impactos recientes</h3>

      {throws.length === 0 ? (
        <p className="mt-3 text-fluid-sm text-ink-3">
          Todavía no le pegaron a nadie. Alguien tiene que empezar.
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
                      ? (byId.get(row.fromPlayer)?.displayName ?? 'Alguien')
                      : 'Alguien'}
                  </span>
                  <span className="text-ink-3"> le pegó a </span>
                  <span className="font-medium">
                    {byId.get(row.toPlayer)?.displayName ?? 'alguien'}
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
      <h2 className="display mt-4 text-fluid-lg">Conchas Azules</h2>
      <p className="mt-2 text-fluid-sm text-ink-2">
        Ganalas haciendo algo absurdo en una partida. Gastalas haciendo sufrir a
        otro.
      </p>
      <a
        href={loginUrl()}
        className="eyebrow mt-6 inline-flex min-h-12 items-center rounded-full px-6 text-void"
        style={{
          background: 'var(--color-accent)',
          boxShadow: '0 0 36px -14px var(--color-accent)',
        }}
      >
        Entrar con Discord
      </a>
    </div>
  );
}

function Unlinked({ username }: { username: string }) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-carbon p-8 text-center">
      <ShellMark size={48} />
      <h2 className="display mt-4 text-fluid-lg">Casi</h2>
      <p className="mt-2 text-fluid-sm text-ink-2">
        Entraste como <strong>{username}</strong>, pero esta cuenta de Discord
        todavía no está vinculada a un jugador. Un admin lo hace desde el panel.
      </p>
    </div>
  );
}

/** Drawn rather than imported, so it inherits the accent colour and can dim. */
export function ShellMark({
  size = 24,
  filled = false,
  owed = false,
}: {
  size?: number;
  filled?: boolean;
  /** A shell you owe rather than hold. Drawn red, and always filled. */
  owed?: boolean;
}) {
  const colour = owed
    ? 'var(--color-mark-red)'
    : filled
      ? 'var(--color-accent)'
      : 'var(--color-line-strong)';

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
      style={
        filled
          ? {
              filter: `drop-shadow(0 0 8px color-mix(in oklab, ${owed ? 'var(--color-mark-red)' : 'var(--color-accent)'} 60%, transparent))`,
            }
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
