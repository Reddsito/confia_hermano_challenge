import {
  MAX_STAKE,
  MIN_STAKE,
  OFFERED_MARKETS,
  bettingOpen,
  canAfford,
  isOffered,
  isSelectionOf,
  type BetMarket,
} from '@challenge/core/domain';
import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import {
  balanceForHolder,
  betStandings,
  holderFor,
  liveWagers,
  openBets,
  placeBet,
} from '../db/bets';
import { coinWallet } from '../db/coins';
import type { Db } from '../db/index';
import { activeGames } from '../db/matches';
import { listPlayers } from '../db/players';
import { currentUser } from './auth';

export function betRoutes(db: Db, config: ServerConfig) {
  const app = new Hono();

  /** The betting ladder. Public: it is a scoreboard, not a wallet. */
  app.get('/standings', (context) => {
    const names = new Map(
      listPlayers(db, 'approved').map((player) => [player.id, player.displayName]),
    );

    return context.json({
      standings: betStandings(db).map((row) => ({
        ...row,
        // A spectator has no roster entry, so their Discord name is the only
        // name they have.
        displayName: row.playerId
          ? (names.get(row.playerId) ?? row.username)
          : row.username,
      })),
    });
  });

  /**
   * Every open wager on every live game, with names.
   *
   * Public: the point of betting on your friends is that they get to see it.
   * Only what was staked is exposed, never anybody's balance.
   */
  app.get('/live', (context) => {
    const names = new Map(
      listPlayers(db, 'approved').map((player) => [player.id, player.displayName]),
    );

    return context.json({
      wagers: liveWagers(db).map((wager) => ({
        ...wager,
        // A spectator has no roster entry, so their Discord name is the only
        // name they have.
        bettorName: wager.bettorPlayerId
          ? (names.get(wager.bettorPlayerId) ?? wager.username)
          : wager.username,
        onName: names.get(wager.playerId) ?? 'alguien',
      })),
    });
  });

  /** What the signed-in account is holding and what it still has riding. */
  app.get('/me', (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Entrá con Discord primero.' }, 401);
    }

    return context.json({
      wallet: coinWallet(db, user.discordId),
      balance: balanceForHolder(db, user.discordId),
      maxStake: MAX_STAKE,
      markets: OFFERED_MARKETS,
      open: openBets(db, user.discordId),
    });
  });

  /**
   * Places a wager on somebody else's live game.
   *
   * Everything the client sends is re-derived here: the game it names must
   * actually be live, must actually contain that player, and must still be
   * inside the window. A client that lies about any of it gets a 400 rather
   * than a bet on a game that already finished.
   */
  app.post('/', async (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Entrá con Discord primero.' }, 401);
    }

    const holder = holderFor(db, user.discordId);
    if (!holder) return context.json({ error: 'Cuenta desconocida.' }, 401);

    const body = await context.req
      .json<{
        playerId?: string;
        market?: string;
        selection?: string;
        stake?: number;
      }>()
      .catch(() => ({}) as Record<string, never>);

    const playerId = body.playerId ?? '';
    const market = body.market ?? '';
    const selection = body.selection ?? '';

    // Checked against the offer, not the vocabulary: a market that has been
    // withdrawn still settles the wagers already on it, but takes no new ones.
    if (!isOffered(market)) {
      return context.json({ error: 'Ese mercado no está abierto.' }, 400);
    }
    if (!isSelectionOf(market as BetMarket, selection)) {
      return context.json({ error: 'Esa opción no es de ese mercado.' }, 400);
    }

    const stake = Math.trunc(Number(body.stake));
    if (!Number.isFinite(stake) || stake < MIN_STAKE || stake > MAX_STAKE) {
      return context.json(
        { error: `Podés apostar ${MIN_STAKE} o ${MAX_STAKE} monedas.` },
        400,
      );
    }

    // You cannot bet on yourself. Half these markets are things the player
    // decides on purpose, and a bet on your own kill count is not a bet.
    if (holder.playerId && holder.playerId === playerId) {
      return context.json({ error: 'No podés apostar a tu propia partida.' }, 400);
    }

    const live = activeGames(db).find((entry) => entry.playerIds.includes(playerId));
    if (!live) {
      return context.json({ error: 'Ese jugador no está en partida.' }, 404);
    }

    if (!bettingOpen(live.game.gameLength)) {
      return context.json(
        { error: 'La ventana de apuestas de esa partida ya cerró.' },
        409,
      );
    }

    const gameId = String(live.game.gameId);

    // One bet per game, whatever the market. activeGames merges live rows by
    // gameId, so two roster players in the same match are one entry with one
    // game_id — betting on "the game" rather than on each of them falls out of
    // that for free, and the partial unique index backs it at the schema level.
    const already = db
      .prepare(
        `SELECT 1 FROM bets
         WHERE discord_id = ? AND game_id = ? AND status != 'VOID'`,
      )
      .get(user.discordId, gameId);
    if (already) {
      return context.json({ error: 'Ya apostaste a esta partida.' }, 409);
    }

    // No debt anywhere: you bet what you have or you do not bet.
    const wallet = coinWallet(db, user.discordId);
    if (!canAfford(wallet.coins, stake)) {
      return context.json(
        {
          error:
            wallet.coins === 0
              ? 'No tenés monedas. Jugá o esperá a mañana.'
              : `No te alcanza. Tenés ${wallet.coins} ${wallet.coins === 1 ? 'moneda' : 'monedas'}.`,
        },
        409,
      );
    }

    const bet = placeBet(db, {
      discordId: user.discordId,
      playerId,
      gameId,
      market,
      selection,
      stake,
    });

    return context.json(
      { bet, wallet: coinWallet(db, user.discordId) },
      201,
    );
  });

  return app;
}
