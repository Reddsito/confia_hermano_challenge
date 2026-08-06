import {
  MAX_STAKE,
  MIN_SHELLS,
  OFFERED_MARKETS,
  bettingOpen,
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

    const balance = balanceForHolder(db, user.discordId);
    return context.json({
      balance,
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
    if (!Number.isFinite(stake) || stake < 1 || stake > MAX_STAKE) {
      return context.json(
        { error: `Podés apostar entre 1 y ${MAX_STAKE} conchas.` },
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

    const already = db
      .prepare(
        `SELECT 1 FROM bets
         WHERE discord_id = ? AND game_id = ? AND market = ? AND status != 'VOID'`,
      )
      .get(user.discordId, gameId, market);
    if (already) {
      return context.json(
        { error: 'Ya apostaste a eso en esta partida.' },
        409,
      );
    }

    // Uncovered betting is allowed, but only down to the floor. Checked against
    // what the stake would leave behind, not against what is held now.
    const balance = balanceForHolder(db, user.discordId);
    if (balance.available - stake < MIN_SHELLS) {
      return context.json(
        {
          error:
            balance.available <= MIN_SHELLS
              ? 'Estás en el fondo. Ganá una concha antes de volver a apostar.'
              : `No podés bajar de ${MIN_SHELLS}. Te alcanza para ${balance.available - MIN_SHELLS}.`,
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
      { bet, balance: balanceForHolder(db, user.discordId) },
      201,
    );
  });

  return app;
}
