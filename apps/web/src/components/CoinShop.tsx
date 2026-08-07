import { useState } from 'react';

import {
  MAX_HELD_SHELLS,
  SHELL_PRICE_COINS,
  SPECTATOR_DAILY_GRANT,
  canBuyShell,
} from '@challenge/core/domain';

import { buyShell } from '../lib/coins';
import type { CoinWallet } from '../lib/coins';

/**
 * Buying a blue shell with monedas.
 *
 * The grind is the point: fifteen coins is three days for somebody playing
 * hard, so the card leads with how far away the next one is rather than with a
 * button that is usually disabled for no stated reason.
 */
export function CoinShop({
  wallet,
  heldShells,
  token,
  onBought,
}: {
  wallet: CoinWallet | null;
  heldShells: number;
  token: string | null;
  onBought: () => void;
}) {
  const [buying, setBuying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!wallet || !token) return null;

  const check = canBuyShell(wallet.coins, heldShells, MAX_HELD_SHELLS);
  const progress = Math.min(1, wallet.coins / SHELL_PRICE_COINS);

  const buy = async () => {
    setBuying(true);
    setError(null);
    try {
      await buyShell(token);
      onBought();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo comprar.');
    } finally {
      setBuying(false);
    }
  };

  return (
    <div className="rounded-2xl border border-line bg-carbon p-4">
      <div className="flex items-baseline justify-between gap-3">
        <p className="eyebrow text-ink-3">Tienda</p>
        <span className="tabular text-fluid-sm font-semibold text-ink">
          {wallet.coins}
          <span className="text-ink-3">/{wallet.cap}</span>
        </span>
      </div>

      <p className="mt-2 text-fluid-sm">
        Una concha azul cuesta {SHELL_PRICE_COINS} monedas.
      </p>

      {/* The bar is against the price, not against the wallet cap: what matters
          here is how close the next shell is. */}
      <div
        className="mt-3 h-1.5 overflow-hidden rounded-full bg-void"
        role="presentation"
      >
        <div
          className="h-full rounded-full transition-[width] duration-500"
          style={{
            width: `${progress * 100}%`,
            backgroundColor: 'var(--color-accent)',
          }}
        />
      </div>

      <button
        type="button"
        onClick={buy}
        disabled={!check.ok || buying}
        title={check.ok ? undefined : check.reason}
        className="mt-3 min-h-10 w-full rounded-xl border border-line-strong text-fluid-sm transition-colors hover:bg-carbon-2 disabled:opacity-40 disabled:hover:bg-transparent"
      >
        {buying ? 'Comprando…' : 'Comprar una concha'}
      </button>

      {!check.ok && (
        <p className="mt-2 text-fluid-xs text-ink-3">{check.reason}</p>
      )}

      {error && (
        <p
          role="alert"
          className="mt-2 text-fluid-xs"
          style={{ color: 'var(--color-mark-red)' }}
        >
          {error}
        </p>
      )}

      <p className="mt-3 text-[0.68rem] text-ink-3">
        {wallet.isSpectator
          ? `Ganás ${SPECTATOR_DAILY_GRANT} monedas por día hasta ${wallet.cap}, y apostando podés pasarte.`
          : `Hoy llevás ${wallet.earnedToday} de ${wallet.dailyCap} monedas. El día cierra a medianoche.`}
      </p>
    </div>
  );
}
