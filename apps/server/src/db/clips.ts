import type { Db } from './index';

export interface ClipRow {
  id: string;
  title: string;
  discordId: string;
  uploaderName: string;
  uploaderAvatar: string | null;
  playerId: string | null;
  objectKey: string;
  contentType: string;
  sizeBytes: number;
  duration: number | null;
  createdAt: number;
  likes: number;
  /** Whether the caller liked it. Always false when signed out. */
  likedByMe: boolean;
}

export type ClipSort = 'recent' | 'liked';

/**
 * Likes are counted in the same query rather than fetched per clip: the grid
 * shows every clip at once, so a second round trip per card would be an N+1
 * over the whole section.
 */
export function listClips(
  db: Db,
  viewerDiscordId: string | null,
  sort: ClipSort = 'recent',
): ClipRow[] {
  const order =
    sort === 'liked'
      ? 'likes DESC, c.created_at DESC'
      : 'c.created_at DESC';

  return db
    .prepare(
      `SELECT c.id, c.title, c.discord_id AS discordId,
              u.username AS uploaderName, u.avatar AS uploaderAvatar,
              c.player_id AS playerId, c.object_key AS objectKey,
              c.content_type AS contentType, c.size_bytes AS sizeBytes,
              c.duration, c.created_at AS createdAt,
              (SELECT COUNT(*) FROM clip_likes l WHERE l.clip_id = c.id) AS likes,
              EXISTS (
                SELECT 1 FROM clip_likes l
                WHERE l.clip_id = c.id AND l.discord_id = ?
              ) AS likedByMe
       FROM clips c
       JOIN discord_users u ON u.discord_id = c.discord_id
       ORDER BY ${order}`,
    )
    // SQLite has no boolean, so EXISTS comes back as 0 or 1.
    .all(viewerDiscordId ?? '')
    .map((row) => {
      const clip = row as Omit<ClipRow, 'likedByMe'> & { likedByMe: number };
      return { ...clip, likedByMe: clip.likedByMe === 1 };
    });
}

export function getClip(db: Db, id: string): ClipRow | null {
  return (
    (db
      .prepare(
        `SELECT c.id, c.discord_id AS discordId, c.object_key AS objectKey
         FROM clips c WHERE c.id = ?`,
      )
      .get(id) as ClipRow | undefined) ?? null
  );
}

export function insertClip(
  db: Db,
  clip: {
    id: string;
    title: string;
    discordId: string;
    playerId: string | null;
    objectKey: string;
    contentType: string;
    sizeBytes: number;
    duration: number | null;
  },
): void {
  db.prepare(
    `INSERT INTO clips (id, title, discord_id, player_id, object_key,
                        content_type, size_bytes, duration, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    clip.id,
    clip.title,
    clip.discordId,
    clip.playerId,
    clip.objectKey,
    clip.contentType,
    clip.sizeBytes,
    clip.duration,
    Date.now(),
  );
}

export function deleteClip(db: Db, id: string): void {
  db.prepare('DELETE FROM clips WHERE id = ?').run(id);
}

/** Returns the like state after the toggle, so the client never has to guess. */
export function toggleLike(
  db: Db,
  clipId: string,
  discordId: string,
): { liked: boolean; likes: number } {
  let liked = false;

  db.transaction(() => {
    const existing = db
      .prepare('SELECT 1 FROM clip_likes WHERE clip_id = ? AND discord_id = ?')
      .get(clipId, discordId);

    if (existing) {
      db.prepare(
        'DELETE FROM clip_likes WHERE clip_id = ? AND discord_id = ?',
      ).run(clipId, discordId);
    } else {
      db.prepare(
        'INSERT INTO clip_likes (clip_id, discord_id, liked_at) VALUES (?, ?, ?)',
      ).run(clipId, discordId, Date.now());
      liked = true;
    }
  })();

  const { count } = db
    .prepare('SELECT COUNT(*) AS count FROM clip_likes WHERE clip_id = ?')
    .get(clipId) as { count: number };

  return { liked, likes: count };
}

/** How many clips this person uploaded today, for the per-day cap. */
export function clipsUploadedSince(
  db: Db,
  discordId: string,
  since: number,
): number {
  const { count } = db
    .prepare(
      'SELECT COUNT(*) AS count FROM clips WHERE discord_id = ? AND created_at >= ?',
    )
    .get(discordId, since) as { count: number };

  return count;
}
