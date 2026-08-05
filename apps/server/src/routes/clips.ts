import { randomUUID } from 'node:crypto';

import { Hono } from 'hono';

import type { ServerConfig } from '../config';
import {
  clipsUploadedSince,
  deleteClip,
  getClip,
  insertClip,
  listClips,
  toggleLike,
  type ClipSort,
} from '../db/clips';
import type { Db } from '../db/index';
import { listPlayers } from '../db/players';
import { deleteObject, presignPut, publicUrlFor } from '../storage/r2';
import { currentUser } from './auth';

/**
 * 200MB. A ten-second highlight off OBS is 20-60MB, so this leaves room for a
 * full teamfight without letting anyone park a movie in the bucket.
 */
const MAX_BYTES = 200 * 1024 * 1024;

/** Per person per rolling day, to keep one enthusiast from flooding the grid. */
const MAX_PER_DAY = 10;

/**
 * Extensions matter as much as the MIME type: the object is served straight
 * from R2 to a <video> element, and a key with no known extension gets a
 * content type the browser refuses to play.
 */
const ALLOWED: Record<string, string> = {
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
};

interface ClipBody {
  id?: string;
  objectKey?: string;
  title?: string;
  contentType?: string;
  sizeBytes?: number;
  duration?: number | null;
  playerId?: string | null;
}

export function clipRoutes(db: Db, config: ServerConfig) {
  const app = new Hono();

  /** Public: anyone can watch, only uploading and liking need an account. */
  app.get('/', (context) => {
    const viewer = currentUser(db, context.req.header('authorization'), config);
    const sort: ClipSort =
      context.req.query('sort') === 'liked' ? 'liked' : 'recent';

    const r2 = config.r2;
    return context.json({
      // Without a bucket there is nothing to upload to, and the client hides
      // the whole section rather than showing a button that 503s.
      enabled: Boolean(r2),
      maxBytes: MAX_BYTES,
      maxPerDay: MAX_PER_DAY,
      clips: r2
        ? listClips(db, viewer?.discordId ?? null, sort).map((clip) => ({
            ...clip,
            url: publicUrlFor(r2, clip.objectKey),
            // The object key is an implementation detail of storage; handing it
            // to the client would invite guessing at other keys.
            objectKey: undefined,
            mine: viewer ? viewer.discordId === clip.discordId : false,
          }))
        : [],
    });
  });

  /**
   * Step one of an upload: validate, then hand back a URL the browser PUTs to.
   *
   * The size is checked here, before the URL exists, because a presigned PUT
   * with an unsigned payload cannot enforce one afterwards.
   */
  app.post('/upload-url', async (context) => {
    const r2 = config.r2;
    if (!r2) return context.json({ error: 'Clips are not configured.' }, 503);

    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Sign in with Discord first.' }, 401);
    }

    const body = await context.req
      .json<{ contentType?: string; sizeBytes?: number }>()
      .catch(() => ({}) as { contentType?: string; sizeBytes?: number });

    const extension = ALLOWED[body.contentType ?? ''];
    if (!extension) {
      return context.json(
        { error: 'Only MP4, WebM and MOV videos are accepted.' },
        400,
      );
    }

    const size = Number(body.sizeBytes);
    if (!Number.isFinite(size) || size <= 0 || size > MAX_BYTES) {
      return context.json(
        { error: `The video must be under ${Math.round(MAX_BYTES / 1024 / 1024)}MB.` },
        400,
      );
    }

    const today = Date.now() - 24 * 60 * 60 * 1000;
    if (clipsUploadedSince(db, user.discordId, today) >= MAX_PER_DAY) {
      return context.json(
        { error: `Up to ${MAX_PER_DAY} clips per day. Try again tomorrow.` },
        429,
      );
    }

    // A random id rather than the filename: names collide, carry the uploader's
    // local paths, and can contain anything at all.
    const id = randomUUID();
    const objectKey = `clips/${id}.${extension}`;

    return context.json({ id, objectKey, uploadUrl: presignPut(r2, objectKey) });
  });

  /**
   * Step two: the browser confirms its upload landed, and only then does a row
   * appear. Nothing here trusts the client about size or type beyond what was
   * already validated when the URL was signed.
   */
  app.post('/', async (context) => {
    const r2 = config.r2;
    if (!r2) return context.json({ error: 'Clips are not configured.' }, 503);

    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Sign in with Discord first.' }, 401);
    }

    const body = await context.req
      .json<ClipBody>()
      .catch(() => ({}) as ClipBody);

    const id = body.id ?? '';
    const objectKey = body.objectKey ?? '';
    // The key must be the one this endpoint would have minted for that id, or
    // a caller could point a row at any object in the bucket.
    if (!id || !objectKey.startsWith(`clips/${id}.`)) {
      return context.json({ error: 'Bad upload reference.' }, 400);
    }

    const contentType = body.contentType ?? '';
    if (!ALLOWED[contentType]) {
      return context.json({ error: 'Unsupported video type.' }, 400);
    }

    const title = (body.title ?? '').trim().slice(0, 120);
    if (!title) return context.json({ error: 'Give the clip a title.' }, 400);

    const playerId =
      body.playerId &&
      listPlayers(db, 'approved').some((player) => player.id === body.playerId)
        ? body.playerId
        : null;

    const duration =
      typeof body.duration === 'number' && Number.isFinite(body.duration)
        ? body.duration
        : null;

    insertClip(db, {
      id,
      title,
      discordId: user.discordId,
      playerId,
      objectKey,
      contentType,
      sizeBytes: Math.max(0, Math.trunc(Number(body.sizeBytes) || 0)),
      duration,
    });

    return context.json({ ok: true, id, url: publicUrlFor(r2, objectKey) });
  });

  app.post('/:id/like', (context) => {
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Sign in with Discord first.' }, 401);
    }

    const id = context.req.param('id');
    if (!getClip(db, id)) return context.json({ error: 'No such clip.' }, 404);

    return context.json(toggleLike(db, id, user.discordId));
  });

  /** The uploader can remove their own; an admin can remove anyone's. */
  app.delete('/:id', async (context) => {
    const r2 = config.r2;
    const user = currentUser(db, context.req.header('authorization'), config);
    if (!user) {
      return context.json({ error: 'Sign in with Discord first.' }, 401);
    }

    const clip = getClip(db, context.req.param('id'));
    if (!clip) return context.json({ error: 'No such clip.' }, 404);

    if (clip.discordId !== user.discordId && !user.isAdmin) {
      return context.json({ error: 'Not your clip.' }, 403);
    }

    deleteClip(db, clip.id);
    // The row is what the site reads, so it goes first; a failed object delete
    // leaves bytes behind but never a card pointing at a missing video.
    if (r2) {
      await deleteObject(r2, clip.objectKey).catch(() => undefined);
    }

    return context.json({ ok: true });
  });

  return app;
}
