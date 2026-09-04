import { randomUUID } from 'node:crypto';

import {
  MAX_HELD_SHELLS,
  MAX_HELD_SHIELDS,
  SHELL_PRICE_COINS,
  SHELL_SHOP_RULE,
  SHIELD_PRICE_COINS,
  canBuyShell,
  canBuyShield,
} from '@challenge/core/domain';
import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import { balanceForHolder, holderFor } from '../db/bets';
import { coinWallet, debitCoins, listCoinLedger } from '../db/coins';
import { grantShield, liveShields } from '../db/shells';
import type { Db } from '../db/index';
import { currentUser } from './auth';

export function coinRoutes(db: Db, config: ServerConfig) {
  const app = new Hono();

  /** The signed-in account's wallet and what it has been doing. */
  app.get('/me', (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Entrá con Discord primero.' }, 401);
    }

    return context.json({
      wallet: coinWallet(db, user.discordId),
      shells: balanceForHolder(db, user.discordId),
      ledger: listCoinLedger(db, user.discordId),
      shellPrice: SHELL_PRICE_COINS,
      shieldPrice: SHIELD_PRICE_COINS,
      // Spectators cannot be hit, so they have nothing to shield.
      shields: user.playerId ? liveShields(db, user.playerId).length : 0,
      maxShields: MAX_HELD_SHIELDS,
    });
  });

  /**
   * Buys one blue shell.
   *
   * Deliberately not routed through awardShells: that function trims an award
   * to the headroom left under the cap, which here would take fifteen coins and
   * hand back nothing. The cap is checked up front instead, and the row is
   * written directly.
   */
  app.post('/shop/shell', (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Entrá con Discord primero.' }, 401);
    }

    const holder = holderFor(db, user.discordId);
    if (!holder) return context.json({ error: 'Cuenta desconocida.' }, 401);

    const wallet = coinWallet(db, user.discordId);
    const shells = balanceForHolder(db, user.discordId);

    const check = canBuyShell(wallet.coins, shells.available, MAX_HELD_SHELLS);
    if (!check.ok) return context.json({ error: check.reason }, 409);

    const purchaseId = randomUUID();

    let bought = false;
    db.transaction(() => {
      const paid = debitCoins(db, user.discordId, {
        source: 'SHOP_SHELL',
        ref: purchaseId,
        amount: SHELL_PRICE_COINS,
        detail: 'Compra de concha azul',
      });
      if (!paid) return;

      if (holder.playerId) {
        // Written into the same ledger achievements use, so a bought shell can
        // be thrown, counted and stolen with nothing else needing to know it
        // was bought. The synthetic match_id keeps the idempotency key unique.
        db.prepare(
          `INSERT INTO blue_shells (id, player_id, match_id, rule, amount, detail, earned_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        ).run(
          randomUUID(),
          holder.playerId,
          `shop:${purchaseId}`,
          SHELL_SHOP_RULE,
          'Comprada con monedas',
          Date.now(),
        );
      } else {
        // Spectators have no roster entry, so blue_shells cannot hold this.
        db.prepare(
          `INSERT INTO shell_grants (id, discord_id, amount, source, detail, created_at)
           VALUES (?, ?, 1, ?, ?, ?)`,
        ).run(
          purchaseId,
          user.discordId,
          SHELL_SHOP_RULE,
          'Comprada con monedas',
          Date.now(),
        );
      }

      bought = true;
    })();

    if (!bought) {
      return context.json({ error: 'No te alcanza.' }, 409);
    }

    return context.json({
      wallet: coinWallet(db, user.discordId),
      shells: balanceForHolder(db, user.discordId),
    });
  });

  /**
   * Buys one shield, which is live from the moment it is paid for.
   *
   * Only a roster player can hold one: a shield stops a shell aimed at you, and
   * nothing can ever be aimed at a spectator.
   */
  app.post('/shop/shield', (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Entrá con Discord primero.' }, 401);
    }
    if (!user.playerId) {
      return context.json(
        { error: 'Solo los jugadores del roster pueden llevar escudo.' },
        403,
      );
    }

    const wallet = coinWallet(db, user.discordId);
    const held = liveShields(db, user.playerId).length;

    const check = canBuyShield(wallet.coins, held);
    if (!check.ok) return context.json({ error: check.reason }, 409);

    const purchaseId = randomUUID();
    let bought = false;

    db.transaction(() => {
      const paid = debitCoins(db, user.discordId, {
        source: 'SHOP_SHIELD',
        ref: purchaseId,
        amount: SHIELD_PRICE_COINS,
        detail: 'Compra de escudo',
      });
      if (!paid) return;

      grantShield(db, user.playerId!, purchaseId);
      bought = true;
    })();

    if (!bought) return context.json({ error: 'No te alcanza.' }, 409);

    return context.json({
      wallet: coinWallet(db, user.discordId),
      shields: liveShields(db, user.playerId).length,
    });
  });

  return app;
}
