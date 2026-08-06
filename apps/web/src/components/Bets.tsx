import { useCallback, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  BET_MARKETS,
  BET_MARKET_LABEL,
  BET_PAYOUT,
  BET_SELECTIONS,
  BET_SELECTION_LABEL,
  MAX_STAKE,
  type BetMarket,
} from '@challenge/core/domain';

import {
  fetchStandings,
  placeBet,
  type BetStanding,
  type Wallet,
} from '../lib/bets';
import type { SessionUser } from '../lib/session';
import { classNames } from './ui';

const GOLD = '#f2c94c';
const RED = 'var(--color-mark-red)';
const TEAL = 'var(--color-mark-teal)';

/**
 * The shell rack: filled, empty and owed.
 *
 * Debt is drawn as its own red slots to the left of the rack rather than as a
 * negative number, because the whole point of the rack is that you read your
 * balance without reading anything.
 */
export function ShellRack({
  available,
  ceiling,
  size = 10,
}: {
  available: number;
  ceiling: number;
  size?: number;
}) {
  const owed = available < 0 ? -available : 0;
  const held = Math.max(available, 0);

  return (
    <span className="inline-flex items-center gap-1" aria-hidden="true">
      {Array.from({ length: owed }, (_, index) => (
        <span
          key={`debt-${index}`}
          className="rounded-full"
          style={{
            width: size,
            height: size,
            backgroundColor: RED,
            boxShadow: `0 0 6px color-mix(in oklab, ${RED} 60%, transparent)`,
          }}
        />
      ))}
      {Array.from({ length: ceiling }, (_, index) => (
        <span
          key={index}
          className="rounded-full border"
          style={{
            width: size,
            height: size,
            backgroundColor: index < held ? GOLD : 'transparent',
            borderColor:
              index < held
                ? GOLD
                : 'color-mix(in oklab, var(--color-line-strong) 90%, transparent)',
          }}
        />
      ))}
    </span>
  );
}

export function WalletChip({ wallet }: { wallet: Wallet }) {
  return (
    <span className="inline-flex items-center gap-2 rounded-full border border-line bg-carbon/80 px-3 py-1.5 backdrop-blur">
      <ShellRack available={wallet.available} ceiling={wallet.ceiling} size={8} />
      <span
        className="eyebrow text-[0.62rem]"
        style={{ color: wallet.available < 0 ? RED : 'var(--color-ink-2)' }}
      >
        {wallet.available < 0
          ? `Debés ${wallet.debt}`
          : `${wallet.available}/${wallet.ceiling}`}
      </span>
    </span>
  );
}

/**
 * The betting ladder.
 *
 * Sorted by net rather than by wins: somebody who won six one-shell bets and
 * lost two doubles is not ahead, and a column of raw wins would say they were.
 */
export function BetStandingsTable({ refreshKey }: { refreshKey: number }) {
  const [standings, setStandings] = useState<BetStanding[] | null>(null);

  const load = useCallback(async () => {
    try {
      setStandings(await fetchStandings());
    } catch {
      setStandings([]);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  return (
    <section className="rounded-2xl border border-line bg-carbon">
      <header
        className="flex items-center gap-2 border-b border-line px-4 py-3"
        style={{ boxShadow: `inset 0 2px 0 0 ${GOLD}` }}
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ backgroundColor: GOLD }}
        />
        <h3 className="eyebrow" style={{ color: GOLD }}>
          Ranking de apuestas
        </h3>
      </header>

      {standings === null ? (
        <p className="px-4 py-6 text-center text-fluid-xs text-ink-3">Cargando…</p>
      ) : standings.length === 0 ? (
        <p className="px-4 py-8 text-center text-fluid-xs text-ink-3">
          Todavía no se resolvió ninguna apuesta.
        </p>
      ) : (
        <ul className="divide-y divide-line">
          {standings.map((row, index) => (
            <li
              key={row.discordId}
              className="flex items-center gap-3 px-4 py-2.5"
            >
              <span className="w-4 shrink-0 text-fluid-xs text-ink-3">
                {index + 1}
              </span>

              <span className="min-w-0 flex-1">
                <span className="block truncate text-fluid-sm">
                  {row.displayName}
                </span>
                <span className="block text-fluid-xs text-ink-3">
                  {row.won}G · {row.lost}P
                  {row.isSpectator && ' · espectador'}
                </span>
              </span>

              <span
                className="display shrink-0 text-fluid-sm"
                style={{
                  color: row.net > 0 ? TEAL : row.net < 0 ? RED : 'var(--color-ink-3)',
                }}
              >
                {row.net > 0 ? `+${row.net}` : row.net}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

/**
 * Places a wager on one live game.
 *
 * The window is enforced by the server; this only hides the button once it has
 * clearly passed, so nobody fills in a form that is going to be rejected.
 */
export function BetModal({
  user,
  token,
  playerId,
  playerName,
  onClose,
  onPlaced,
}: {
  user: SessionUser;
  token: string;
  playerId: string;
  playerName: string;
  onClose: () => void;
  onPlaced: (wallet: Wallet) => void;
}) {
  const [market, setMarket] = useState<BetMarket>('WIN');
  const [selection, setSelection] = useState<string>(BET_SELECTIONS.WIN[0]);
  const [stake, setStake] = useState(1);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  const wallet = user.wallet;

  useEffect(() => {
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sending) onClose();
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, sending]);

  const submit = async () => {
    setSending(true);
    setError(null);
    try {
      onPlaced(await placeBet(token, { playerId, market, selection, stake }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo apostar.');
      setSending(false);
    }
  };

  const payout = stake * (BET_PAYOUT[selection] ?? 1);

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => !sending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Apostar a la partida de ${playerName}`}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-carbon sm:rounded-2xl"
      >
        <header
          className="flex items-center gap-3 border-b border-line p-4"
          style={{ boxShadow: `inset 0 2px 0 0 ${GOLD}` }}
        >
          <div className="min-w-0 flex-1">
            <p className="display truncate text-fluid-lg leading-tight" style={{ color: GOLD }}>
              Apostar
            </p>
            <p className="truncate text-fluid-xs text-ink-3">
              Partida de {playerName}
            </p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Cerrar"
            className="eyebrow min-h-9 shrink-0 rounded-full border border-line px-3 text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            Cerrar
          </button>
        </header>

        <div className="space-y-4 p-4">
          {wallet && (
            <div className="flex items-center justify-between gap-3 rounded-xl border border-line bg-void px-3 py-2">
              <span className="eyebrow text-ink-3">Tenés</span>
              <ShellRack available={wallet.available} ceiling={wallet.ceiling} />
            </div>
          )}

          <div>
            <span className="eyebrow text-ink-3">A qué apostás</span>
            <div className="mt-2 space-y-2">
              {BET_MARKETS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => {
                    setMarket(option);
                    setSelection(BET_SELECTIONS[option][0]);
                  }}
                  className={classNames(
                    'w-full rounded-xl border px-3 py-2 text-left text-fluid-sm transition-colors',
                    market === option
                      ? 'border-line-strong bg-carbon-2'
                      : 'border-line hover:border-line-strong',
                  )}
                >
                  {BET_MARKET_LABEL[option]}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="eyebrow text-ink-3">Tu pronóstico</span>
            <div className="mt-2 grid grid-cols-2 gap-2">
              {BET_SELECTIONS[market].map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => setSelection(option)}
                  className="rounded-xl border px-3 py-2 text-fluid-sm transition-colors"
                  style={{
                    color: selection === option ? '#05070a' : 'var(--color-ink-2)',
                    backgroundColor: selection === option ? GOLD : 'transparent',
                    borderColor:
                      selection === option ? GOLD : 'var(--color-line)',
                  }}
                >
                  {BET_SELECTION_LABEL[option] ?? option}
                  {/* The long shot is worth flagging where the choice is made. */}
                  {(BET_PAYOUT[option] ?? 1) > 1 && (
                    <span className="eyebrow ml-1 text-[0.6rem]">
                      paga x{BET_PAYOUT[option]}
                    </span>
                  )}
                </button>
              ))}
            </div>
          </div>

          <div>
            <span className="eyebrow text-ink-3">Cuánto</span>
            <div className="mt-2 flex gap-2">
              {Array.from({ length: MAX_STAKE }, (_, index) => index + 1).map(
                (amount) => (
                  <button
                    key={amount}
                    type="button"
                    onClick={() => setStake(amount)}
                    className="flex-1 rounded-xl border py-2 text-fluid-sm transition-colors"
                    style={{
                      color: stake === amount ? '#05070a' : 'var(--color-ink-2)',
                      backgroundColor: stake === amount ? GOLD : 'transparent',
                      borderColor: stake === amount ? GOLD : 'var(--color-line)',
                    }}
                  >
                    {amount} {amount === 1 ? 'concha' : 'conchas'}
                  </button>
                ),
              )}
            </div>
          </div>

          <p className="text-fluid-xs text-ink-3">
            Si acertás cobrás {payout} de más. Si fallás perdés {stake}, y podés
            quedar debiendo — hasta 2.
          </p>

          {error && (
            <p role="alert" className="text-fluid-xs" style={{ color: RED }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={sending}
            className="eyebrow min-h-10 w-full rounded-full text-void transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: GOLD }}
          >
            {sending ? 'Apostando…' : 'Apostar'}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
