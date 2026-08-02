import type { Db } from './index';

export interface DiscordUserRow {
  discordId: string;
  username: string;
  avatar: string | null;
  playerId: string | null;
  isAdmin: boolean;
  firstSeen: number;
  lastSeen: number;
}

interface RawUser {
  discord_id: string;
  username: string;
  avatar: string | null;
  player_id: string | null;
  is_admin: number;
  first_seen: number;
  last_seen: number;
}

function toUser(row: RawUser): DiscordUserRow {
  return {
    discordId: row.discord_id,
    username: row.username,
    avatar: row.avatar,
    playerId: row.player_id,
    isAdmin: row.is_admin === 1,
    firstSeen: row.first_seen,
    lastSeen: row.last_seen,
  };
}

/**
 * Records a Discord login. The roster link is never touched here — it is set
 * from the panel, so signing in can neither claim nor steal a player.
 */
export function upsertDiscordUser(
  db: Db,
  input: { discordId: string; username: string; avatar: string | null },
): DiscordUserRow {
  const now = Date.now();
  db.prepare(
    `INSERT INTO discord_users (discord_id, username, avatar, player_id, is_admin, first_seen, last_seen)
     VALUES (?, ?, ?, NULL, 0, ?, ?)
     ON CONFLICT (discord_id) DO UPDATE SET
       username  = excluded.username,
       avatar    = excluded.avatar,
       last_seen = excluded.last_seen`,
  ).run(input.discordId, input.username, input.avatar, now, now);

  return getDiscordUser(db, input.discordId)!;
}

export function getDiscordUser(db: Db, discordId: string): DiscordUserRow | null {
  const row = db
    .prepare('SELECT * FROM discord_users WHERE discord_id = ?')
    .get(discordId) as RawUser | undefined;
  return row ? toUser(row) : null;
}

export function listDiscordUsers(db: Db): DiscordUserRow[] {
  const rows = db
    .prepare('SELECT * FROM discord_users ORDER BY last_seen DESC')
    .all() as RawUser[];
  return rows.map(toUser);
}

/** Passing null unlinks. One roster player maps to at most one Discord account. */
export function linkDiscordUser(
  db: Db,
  discordId: string,
  playerId: string | null,
): boolean {
  const exists = getDiscordUser(db, discordId);
  if (!exists) return false;

  db.transaction(() => {
    if (playerId) {
      // Releasing any previous holder keeps the mapping one-to-one.
      db.prepare(
        'UPDATE discord_users SET player_id = NULL WHERE player_id = ? AND discord_id <> ?',
      ).run(playerId, discordId);
    }
    db.prepare('UPDATE discord_users SET player_id = ? WHERE discord_id = ?').run(
      playerId,
      discordId,
    );
  })();

  return true;
}

/** The Discord account linked to a roster player, if any. */
export function getDiscordUserByPlayer(
  db: Db,
  playerId: string,
): DiscordUserRow | null {
  const row = db
    .prepare('SELECT * FROM discord_users WHERE player_id = ?')
    .get(playerId) as RawUser | undefined;
  return row ? toUser(row) : null;
}

/** A Discord mention, or null when the player has not linked an account. */
export function mentionFor(db: Db, playerId: string): string | null {
  const user = getDiscordUserByPlayer(db, playerId);
  return user ? `<@${user.discordId}>` : null;
}
