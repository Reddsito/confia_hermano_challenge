import { Hono } from 'hono';

import { issueSession, readSession } from '../auth/session';
import type { ServerConfig } from '../config';
import type { Db } from '../db/index';
import { balanceFor } from '../db/shells';
import { balanceForHolder, holderFor } from '../db/bets';
import { coinWallet } from '../db/coins';
import {
  getDiscordUser,
  upsertDiscordUser,
  type DiscordUserRow,
} from '../db/users';

const DISCORD_AUTHORIZE = 'https://discord.com/api/oauth2/authorize';
const DISCORD_TOKEN = 'https://discord.com/api/oauth2/token';
const DISCORD_ME = 'https://discord.com/api/users/@me';

export function authRoutes(db: Db, config: ServerConfig) {
  const app = new Hono();

  app.get('/discord', (context) => {
    if (!config.discordOAuth) {
      return context.json({ error: 'Discord login is not configured.' }, 503);
    }

    const params = new URLSearchParams({
      client_id: config.discordOAuth.clientId,
      redirect_uri: config.discordOAuth.redirectUri,
      response_type: 'code',
      // "identify" is all we need: a stable id, a name and an avatar. No email,
      // no guild list, nothing we would then have to justify storing.
      scope: 'identify',
    });

    return context.redirect(`${DISCORD_AUTHORIZE}?${params}`);
  });

  app.get('/discord/callback', async (context) => {
    if (!config.discordOAuth) {
      return context.json({ error: 'Discord login is not configured.' }, 503);
    }

    const code = context.req.query('code');
    if (!code) return context.json({ error: 'Missing code' }, 400);

    try {
      const tokenResponse = await fetch(DISCORD_TOKEN, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: config.discordOAuth.clientId,
          client_secret: config.discordOAuth.clientSecret,
          grant_type: 'authorization_code',
          code,
          redirect_uri: config.discordOAuth.redirectUri,
        }),
      });

      if (!tokenResponse.ok) {
        throw new Error(`token exchange failed (${tokenResponse.status})`);
      }

      const { access_token: accessToken } = (await tokenResponse.json()) as {
        access_token: string;
      };

      const meResponse = await fetch(DISCORD_ME, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!meResponse.ok) throw new Error(`profile failed (${meResponse.status})`);

      const me = (await meResponse.json()) as {
        id: string;
        username: string;
        global_name?: string | null;
        avatar: string | null;
      };

      upsertDiscordUser(db, {
        discordId: me.id,
        username: me.global_name || me.username,
        avatar: me.avatar,
      });

      const session = issueSession(
        {
          discordId: me.id,
          username: me.global_name || me.username,
          avatar: me.avatar,
        },
        config.sessionSecret,
      );

      // The token travels in the fragment, which browsers never send to a
      // server and which stays out of access logs and Referer headers.
      const target = config.siteUrl || '/';
      return context.redirect(`${target}#session=${encodeURIComponent(session)}`);
    } catch (error) {
      console.error('[auth] discord callback failed:', error);
      const target = config.siteUrl || '/';
      return context.redirect(`${target}#auth_error=1`);
    }
  });

  app.get('/me', (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) return context.json({ error: 'Not signed in' }, 401);

    const holder = holderFor(db, user.discordId);

    return context.json({
      discordId: user.discordId,
      username: user.username,
      avatar: user.avatar,
      playerId: user.playerId,
      isAdmin: user.isAdmin,
      // Read off the account, so a spectator — who has no roster entry and
      // therefore no balanceFor — still gets a real number instead of null.
      isSpectator: holder?.isSpectator ?? false,
      shells: user.playerId ? balanceFor(db, user.playerId) : null,
      wallet: balanceForHolder(db, user.discordId),
      // Reading the wallet is also what pays out any daily coins that are due,
      // so signing in is enough to collect.
      coins: coinWallet(db, user.discordId),
    });
  });

  return app;
}

/** Resolves the Authorization header to a stored Discord user, or null. */
export function currentUser(
  db: Db,
  authorization: string | undefined,
  config: ServerConfig,
): DiscordUserRow | null {
  const token = (authorization ?? '').replace(/^Bearer\s+/i, '');
  if (!token) return null;

  const session = readSession(token, config.sessionSecret);
  if (!session) return null;

  return getDiscordUser(db, session.discordId);
}
