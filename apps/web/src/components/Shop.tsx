import { useCallback, useEffect, useState, type ReactElement } from 'react';

import {
  MAX_HELD_SHELLS,
  MAX_HELD_SHIELDS,
  PLAYER_DAILY_GRANT,
  PLAYER_DAILY_EARN_CAP,
  PLAYER_WIN_GRANT,
  SPECTATOR_DAILY_GRANT,
  canBuyShell,
  canBuyShield,
} from '@challenge/core/domain';

import { buyShell, buyShield, fetchCoins, type CoinState } from '../lib/coins';
import type { SessionUser } from '../lib/session';
import { CoinMark, ShellMark } from './BlueShells';
import { classNames } from './ui';

/**
 * The shop.
 *
 * It used to be one card wedged into the corner of the shells panel, selling
 * the single thing it had — which read as a leftover rather than as a place you
 * go. Given a page of its own it can do the job a shop actually has: say what
 * each thing does before it says what it costs, and make the wall you are
 * saving towards visible while you are short.
 *
 * The counter along the top is the wallet, because every refusal in here is
 * about that number and a price you cannot see yourself approaching is just a
 * disabled button.
 */

interface Item {
  key: 'shell' | 'shield';
  name: string;
  tagline: string;
  /** What it actually does, in the terms the rules use. */
  detail: string;
  accent: string;
  Mark: (props: { size?: number }) => ReactElement;
}

const ITEMS: Item[] = [
  {
    key: 'shell',
    name: 'Concha azul',
    tagline: 'Se la tirás a quien quieras',
    detail:
      'La ruleta le asigna un reto que tiene que cumplir en su siguiente partida. Podés llevar hasta ' +
      `${MAX_HELD_SHELLS} sin tirar.`,
    accent: 'var(--color-mark-blue)',
    Mark: ({ size = 22 }) => <ShellMark size={size} />,
  },
  {
    key: 'shield',
    name: 'Escudo',
    tagline: 'Para la próxima que te tiren',
    detail:
      'Se activa solo al comprarlo: no hay nada que encender. La siguiente concha que te tiren se rompe contra él, y quien la tiró la pierde igual. Se ve en la clasificación. Hasta ' +
      `${MAX_HELD_SHIELDS} a la vez.`,
    accent: 'var(--color-mark-teal)',
    Mark: ({ size = 22 }) => <ShieldMark size={size} />,
  },
];

export function Shop({
  user,
  token,
  onWalletChange,
  revision,
}: {
  user: SessionUser;
  token: string;
  onWalletChange: () => void;
  /** Bumped by the dashboard's refresh cycle; a change refetches the wallet. */
  revision: number;
}) {
  const [state, setState] = useState<CoinState | null>(null);
  const [busy, setBusy] = useState<Item['key'] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [bought, setBought] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setState(await fetchCoins(token));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [token]);

  useEffect(() => {
    void reload();
  }, [reload, revision]);

  const purchase = async (item: Item) => {
    setBusy(item.key);
    setError(null);
    setBought(null);

    try {
      if (item.key === 'shell') await buyShell(token);
      else await buyShield(token);
      setBought(item.name);
      await reload();
      onWalletChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo comprar.');
    } finally {
      setBusy(null);
    }
  };

  if (!state) {
    return (
      <p className="rounded-xl border border-line bg-carbon px-4 py-16 text-center text-fluid-sm text-ink-3">
        Abriendo la caja…
      </p>
    );
  }

  const { wallet } = state;
  const isSpectator = wallet.isSpectator || !user.playerId;

  const checkFor = (item: Item) =>
    item.key === 'shell'
      ? canBuyShell(wallet.coins, state.shells.available, MAX_HELD_SHELLS)
      : isSpectator
        ? {
            ok: false as const,
            reason: 'Solo los jugadores del roster pueden llevar escudo.',
          }
        : canBuyShield(wallet.coins, state.shields);

  const priceFor = (item: Item) =>
    item.key === 'shell' ? state.shellPrice : state.shieldPrice;

  const heldFor = (item: Item) =>
    item.key === 'shell' ? state.shells.available : state.shields;

  const capFor = (item: Item) =>
    item.key === 'shell' ? MAX_HELD_SHELLS : MAX_HELD_SHIELDS;

  return (
    <div className="space-y-4">
      <Counter wallet={wallet} shields={state.shields} shells={state.shells.available} />

      <ul className="grid gap-3 lg:grid-cols-2">
        {ITEMS.map((item) => {
          const price = priceFor(item);
          const check = checkFor(item);
          const held = heldFor(item);
          const cap = capFor(item);
          const short = Math.max(0, price - wallet.coins);

          return (
            <li key={item.key}>
              <article
                className="flex h-full flex-col rounded-xl border bg-carbon p-5"
                style={{
                  borderColor: `color-mix(in oklab, ${item.accent} 35%, var(--color-line))`,
                  boxShadow: `inset 3px 0 0 0 ${item.accent}`,
                }}
              >
                <header className="flex items-start gap-3">
                  <span
                    className="grid size-11 shrink-0 place-items-center rounded-md"
                    style={{
                      color: item.accent,
                      background: `color-mix(in oklab, ${item.accent} 14%, transparent)`,
                    }}
                  >
                    <item.Mark size={22} />
                  </span>

                  <div className="min-w-0 flex-1">
                    <h3 className="display text-fluid-lg leading-none">
                      {item.name}
                    </h3>
                    <p className="mt-1 text-fluid-xs text-ink-3">
                      {item.tagline}
                    </p>
                  </div>

                  <span
                    className="tabular flex shrink-0 items-center gap-1.5 text-fluid-lg leading-none"
                    style={{ color: 'var(--color-gold)' }}
                  >
                    <CoinMark size={15} />
                    {price}
                  </span>
                </header>

                <p className="mt-4 text-fluid-sm text-ink-2">{item.detail}</p>

                <div className="mt-auto pt-5">
                  {/* The wall, drawn. While you are short this is the only
                      thing on the card that changes day to day, so it is the
                      thing worth showing rather than a greyed-out button. */}
                  <div className="mb-2 flex items-baseline justify-between gap-3">
                    <span className="eyebrow text-ink-3">
                      Tenés {held} de {cap}
                    </span>
                    {short > 0 && (
                      <span
                        className="eyebrow"
                        style={{ color: 'var(--color-ink-3)' }}
                      >
                        Te faltan {short}
                      </span>
                    )}
                  </div>

                  <div className="mb-3 h-1 overflow-hidden rounded-sm bg-carbon-3">
                    <span
                      className="block h-full rounded-sm transition-[width] duration-500"
                      style={{
                        width: `${Math.min(100, (wallet.coins / price) * 100)}%`,
                        background:
                          short > 0 ? 'var(--color-line-strong)' : item.accent,
                      }}
                    />
                  </div>

                  <button
                    type="button"
                    disabled={!check.ok || busy !== null}
                    onClick={() => void purchase(item)}
                    className={classNames(
                      'eyebrow min-h-12 w-full rounded-lg px-4 transition-all',
                      'disabled:cursor-not-allowed disabled:opacity-40',
                    )}
                    style={{
                      color: check.ok ? 'var(--color-void)' : 'var(--color-ink-3)',
                      background: check.ok ? item.accent : 'var(--color-carbon-2)',
                      border: check.ok
                        ? 'none'
                        : '1px solid var(--color-line)',
                    }}
                  >
                    {busy === item.key
                      ? 'Comprando…'
                      : check.ok
                        ? `Comprar por ${price}`
                        : check.reason}
                  </button>
                </div>
              </article>
            </li>
          );
        })}
      </ul>

      {bought && (
        <p
          role="status"
          className="eyebrow"
          style={{ color: 'var(--color-mark-teal)' }}
        >
          {bought} comprado.
        </p>
      )}

      {error && (
        <p
          role="alert"
          className="eyebrow"
          style={{ color: 'var(--color-mark-red)' }}
        >
          {error}
        </p>
      )}

      <Earnings wallet={wallet} isSpectator={isSpectator} />
      <Ledger movements={state.ledger} />
    </div>
  );
}

/** The wallet, stated once at the size the whole page is arguing about. */
function Counter({
  wallet,
  shells,
  shields,
}: {
  wallet: CoinState['wallet'];
  shells: number;
  shields: number;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-x-10 gap-y-4 rounded-xl border border-line bg-carbon px-5 py-5">
      <div className="flex items-center gap-3">
        <span style={{ color: 'var(--color-gold)' }}>
          <CoinMark size={30} />
        </span>
        <div>
          <p className="eyebrow text-ink-3">Tu cartera</p>
          <p
            className="tabular text-fluid-xl leading-none"
            style={{ color: 'var(--color-gold)' }}
          >
            {wallet.coins}
            <span className="text-ink-3">/{wallet.cap}</span>
          </p>
        </div>
      </div>

      <dl className="flex flex-wrap gap-x-8 gap-y-3">
        <div>
          <dt className="eyebrow text-ink-3">Conchas</dt>
          <dd className="tabular text-fluid-lg leading-none">{shells}</dd>
        </div>
        <div>
          <dt className="eyebrow text-ink-3">Escudos</dt>
          <dd
            className="tabular text-fluid-lg leading-none"
            style={{
              color: shields > 0 ? 'var(--color-mark-teal)' : undefined,
            }}
          >
            {shields}
          </dd>
        </div>
        <div>
          <dt className="eyebrow text-ink-3">Hoy llevás</dt>
          <dd className="tabular text-fluid-lg leading-none">
            {wallet.earnedToday}
            <span className="text-ink-3">/{wallet.dailyCap}</span>
          </dd>
        </div>
      </dl>
    </div>
  );
}

/** Where the money comes from, since every price here is measured in days. */
function Earnings({
  wallet,
  isSpectator,
}: {
  wallet: CoinState['wallet'];
  isSpectator: boolean;
}) {
  const rows: [string, string][] = isSpectator
    ? [
        ['Por mirar', `${SPECTATOR_DAILY_GRANT} monedas al día`],
        ['Tope diario', `${wallet.dailyCap}`],
        ['Tope de cartera', `${wallet.cap}`],
      ]
    : [
        ['Entrega diaria', `${PLAYER_DAILY_GRANT} por día`],
        ['Por victoria', `${PLAYER_WIN_GRANT} por partida ganada`],
        ['Tope diario', `${PLAYER_DAILY_EARN_CAP} al día`],
        ['Tope de cartera', `${wallet.cap}`],
      ];

  return (
    <section className="rounded-xl border border-line bg-carbon px-5 py-4">
      <h3 className="display text-fluid-lg leading-none">De dónde salen</h3>
      <p className="mt-1 text-fluid-xs text-ink-3">
        Se ganan despacio a propósito. Un objeto cuesta días, y eso es lo que
        hace que usarlo signifique algo.
      </p>

      <dl className="mt-4 grid gap-x-8 border-t border-line sm:grid-cols-2">
        {rows.map(([label, value]) => (
          <div
            key={label}
            className="flex items-baseline justify-between gap-4 border-b border-line py-2.5"
          >
            <dt className="eyebrow text-ink-3">{label}</dt>
            <dd className="tabular text-fluid-sm">{value}</dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

/** The last movements, so a wallet that looks wrong can be checked. */
function Ledger({ movements }: { movements: CoinState['ledger'] }) {
  if (movements.length === 0) return null;

  return (
    <section className="rounded-xl border border-line bg-carbon px-5 py-4">
      <h3 className="display text-fluid-lg leading-none">Movimientos</h3>

      <ul className="mt-3 divide-y divide-line border-t border-line">
        {movements.slice(0, 12).map((movement, index) => (
          <li
            key={`${movement.createdAt}-${index}`}
            className="flex items-baseline justify-between gap-4 py-2"
          >
            <span className="min-w-0 flex-1 truncate text-fluid-xs text-ink-2">
              {movement.detail || movement.source}
            </span>
            <span className="eyebrow shrink-0 text-ink-3">{movement.day}</span>
            <span
              className="tabular w-12 shrink-0 text-right text-fluid-sm"
              style={{
                color:
                  movement.amount >= 0
                    ? 'var(--color-mark-teal)'
                    : 'var(--color-mark-red)',
              }}
            >
              {movement.amount > 0 ? '+' : ''}
              {movement.amount}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A shield, drawn to sit beside the shell mark at the same weight. */
export function ShieldMark({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M12 2.5 4.5 5.5v6c0 4.6 3.1 8.7 7.5 10 4.4-1.3 7.5-5.4 7.5-10v-6L12 2.5Z"
        fill="currentColor"
        fillOpacity="0.18"
        stroke="currentColor"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="m8.6 11.9 2.4 2.4 4.4-4.6"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
