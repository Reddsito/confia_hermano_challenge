import { useCallback, useEffect, useRef, useState } from 'react';

import type { RankedPlayer } from '@challenge/core/domain';

import {
  deleteClip,
  fetchClips,
  toggleClipLike,
  uploadClip,
  type Clip,
  type ClipSort,
} from '../lib/clips';
import type { SessionUser } from '../lib/session';
import { Avatar, classNames } from './ui';

const GOLD = '#f2c94c';

function formatDuration(seconds: number | null): string | null {
  if (seconds === null) return null;
  const total = Math.round(seconds);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

function formatAge(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60000);
  if (minutes < 1) return 'ahora';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `hace ${hours}h`;
  return `hace ${Math.floor(hours / 24)}d`;
}

interface ClipsProps {
  user: SessionUser | null;
  token: string | null;
  players: RankedPlayer[];
}

export function Clips({ user, token, players }: ClipsProps) {
  const [clips, setClips] = useState<Clip[]>([]);
  const [enabled, setEnabled] = useState(true);
  const [sort, setSort] = useState<ClipSort>('recent');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  const load = useCallback(async () => {
    try {
      const data = await fetchClips(token, sort);
      setEnabled(data.enabled);
      setClips(data.clips);
      setError(null);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudieron cargar los clips.');
    } finally {
      setLoading(false);
    }
  }, [token, sort]);

  useEffect(() => {
    void load();
  }, [load]);

  /**
   * The count moves before the request lands. A like is cheap and reversible,
   * and waiting a round trip to fill a heart makes the whole grid feel dead.
   */
  const onLike = async (clip: Clip) => {
    if (!token) return;

    const optimistic = {
      likedByMe: !clip.likedByMe,
      likes: clip.likes + (clip.likedByMe ? -1 : 1),
    };
    setClips((current) =>
      current.map((row) => (row.id === clip.id ? { ...row, ...optimistic } : row)),
    );

    try {
      const result = await toggleClipLike(token, clip.id);
      setClips((current) =>
        current.map((row) =>
          row.id === clip.id
            ? { ...row, likes: result.likes, likedByMe: result.liked }
            : row,
        ),
      );
    } catch {
      // Put the card back the way it was rather than leaving a lie on screen.
      setClips((current) =>
        current.map((row) =>
          row.id === clip.id
            ? { ...row, likes: clip.likes, likedByMe: clip.likedByMe }
            : row,
        ),
      );
    }
  };

  const onDelete = async (clip: Clip) => {
    if (!token) return;
    if (!confirm(`¿Borrar "${clip.title}"?`)) return;

    setClips((current) => current.filter((row) => row.id !== clip.id));
    await deleteClip(token, clip.id).catch(() => void load());
  };

  if (!enabled) {
    return (
      <p className="rounded-xl border border-line bg-carbon px-4 py-6 text-center text-fluid-sm text-ink-3">
        Los clips todavía no están configurados.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="inline-flex rounded-full border border-line bg-carbon/80 p-1 backdrop-blur">
          {(
            [
              { key: 'recent' as const, label: 'Recientes' },
              { key: 'liked' as const, label: 'Más likeados' },
            ]
          ).map((option) => (
            <button
              key={option.key}
              type="button"
              onClick={() => setSort(option.key)}
              className={classNames(
                'eyebrow min-h-8 rounded-full px-3 transition-colors',
                sort === option.key ? 'text-void' : 'text-ink-2 hover:text-ink',
              )}
              style={
                sort === option.key ? { backgroundColor: GOLD } : undefined
              }
            >
              {option.label}
            </button>
          ))}
        </div>

        {user ? (
          <button
            type="button"
            onClick={() => setUploading(true)}
            className="eyebrow inline-flex min-h-9 items-center gap-2 rounded-full px-4 text-void transition-opacity hover:opacity-90"
            style={{ backgroundColor: GOLD }}
          >
            Subir clip
          </button>
        ) : (
          <p className="text-fluid-xs text-ink-3">
            Entrá con Discord para subir y dar like.
          </p>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-line bg-carbon px-3 py-2 text-fluid-xs"
          style={{ color: 'var(--color-mark-red)' }}
        >
          {error}
        </p>
      )}

      {loading ? (
        <p className="py-10 text-center text-fluid-sm text-ink-3">Cargando clips…</p>
      ) : clips.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line px-4 py-12 text-center text-fluid-sm text-ink-3">
          Todavía no hay clips. Sé el primero.
        </p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {clips.map((clip) => (
            <ClipCard
              key={clip.id}
              clip={clip}
              canLike={Boolean(token)}
              onLike={() => void onLike(clip)}
              onDelete={() => void onDelete(clip)}
            />
          ))}
        </div>
      )}

      {uploading && token && (
        <UploadModal
          token={token}
          players={players}
          onClose={() => setUploading(false)}
          onUploaded={() => {
            setUploading(false);
            void load();
          }}
        />
      )}
    </div>
  );
}

function ClipCard({
  clip,
  canLike,
  onLike,
  onDelete,
}: {
  clip: Clip;
  canLike: boolean;
  onLike: () => void;
  onDelete: () => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [playing, setPlaying] = useState(false);
  const duration = formatDuration(clip.duration);

  /**
   * Hover previews muted, click plays for real. Autoplaying every card with
   * sound would be unusable, and `preload="metadata"` keeps a grid of twenty
   * clips from pulling hundreds of megabytes on load.
   */
  const preview = () => {
    if (playing) return;
    const video = videoRef.current;
    if (!video) return;
    video.currentTime = 0;
    void video.play().catch(() => undefined);
  };

  const stopPreview = () => {
    if (playing) return;
    videoRef.current?.pause();
  };

  return (
    <article
      className="group overflow-hidden rounded-2xl border border-line bg-carbon transition-colors hover:border-line-strong"
      onMouseEnter={preview}
      onMouseLeave={stopPreview}
    >
      <div className="relative aspect-video bg-void">
        <video
          ref={videoRef}
          src={clip.url}
          preload="metadata"
          playsInline
          muted={!playing}
          loop={!playing}
          controls={playing}
          onClick={() => {
            if (playing) return;
            setPlaying(true);
            const video = videoRef.current;
            if (video) {
              video.muted = false;
              video.loop = false;
              void video.play().catch(() => undefined);
            }
          }}
          className="size-full cursor-pointer object-cover"
        />

        {!playing && (
          <>
            <span
              aria-hidden="true"
              className="pointer-events-none absolute inset-0 bg-gradient-to-t from-void/70 via-transparent to-transparent"
            />
            {duration && (
              <span className="eyebrow pointer-events-none absolute right-2 bottom-2 rounded-full bg-void/85 px-2 py-0.5 text-[0.62rem] text-ink-2 backdrop-blur">
                {duration}
              </span>
            )}
          </>
        )}
      </div>

      <div className="space-y-3 p-3">
        <p className="display line-clamp-2 text-fluid-sm leading-snug">
          {clip.title}
        </p>

        <div className="flex items-center gap-2">
          <Avatar name={clip.uploaderName} iconId={null} size={24} />
          <p className="min-w-0 flex-1 truncate text-fluid-xs text-ink-3">
            {clip.uploaderName} · {formatAge(clip.createdAt)}
          </p>

          {clip.mine && (
            <button
              type="button"
              onClick={onDelete}
              aria-label="Borrar clip"
              className="eyebrow shrink-0 text-[0.62rem] text-ink-3 opacity-0 transition-opacity group-hover:opacity-100 hover:text-ink"
            >
              Borrar
            </button>
          )}

          <button
            type="button"
            onClick={onLike}
            disabled={!canLike}
            aria-pressed={clip.likedByMe}
            aria-label={clip.likedByMe ? 'Quitar like' : 'Dar like'}
            className={classNames(
              'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2.5 py-1 text-fluid-xs transition-colors',
              canLike ? 'hover:border-line-strong' : 'cursor-default',
            )}
            style={{
              color: clip.likedByMe ? GOLD : 'var(--color-ink-3)',
              borderColor: clip.likedByMe
                ? `color-mix(in oklab, ${GOLD} 45%, transparent)`
                : 'var(--color-line)',
              backgroundColor: clip.likedByMe
                ? `color-mix(in oklab, ${GOLD} 10%, transparent)`
                : 'transparent',
            }}
          >
            <HeartIcon filled={clip.likedByMe} />
            {clip.likes}
          </button>
        </div>
      </div>
    </article>
  );
}

function HeartIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width="13"
      height="13"
      aria-hidden="true"
      fill={filled ? 'currentColor' : 'none'}
      stroke="currentColor"
      strokeWidth="2"
    >
      <path d="M12 20.5 3.8 12.3a5 5 0 0 1 7.1-7.1l1.1 1.1 1.1-1.1a5 5 0 0 1 7.1 7.1Z" />
    </svg>
  );
}

function UploadModal({
  token,
  players,
  onClose,
  onUploaded,
}: {
  token: string;
  players: RankedPlayer[];
  onClose: () => void;
  onUploaded: () => void;
}) {
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [playerId, setPlayerId] = useState('');
  const [dragging, setDragging] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      // Escape must not abandon an upload in flight without the user saying so.
      if (event.key === 'Escape' && progress === null) onClose();
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, progress]);

  const take = (candidate: File | undefined) => {
    if (!candidate) return;
    setFile(candidate);
    // A sensible default so the title field is never the thing that blocks an
    // upload; the filename is almost always better than nothing.
    if (!title) setTitle(candidate.name.replace(/\.[^.]+$/, '').slice(0, 120));
  };

  const submit = async () => {
    if (!file || !title.trim()) return;

    setProgress(0);
    setError(null);
    try {
      await uploadClip(token, file, { title, playerId: playerId || null }, setProgress);
      onUploaded();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Falló la subida.');
      setProgress(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => progress === null && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Subir clip"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-lg overflow-y-auto rounded-t-2xl border border-line bg-carbon sm:rounded-2xl"
      >
        <header
          className="flex items-center gap-3 border-b border-line p-4"
          style={{ boxShadow: `inset 0 2px 0 0 ${GOLD}` }}
        >
          <p className="display flex-1 text-fluid-lg leading-tight" style={{ color: GOLD }}>
            Subir clip
          </p>
          <button
            type="button"
            onClick={onClose}
            disabled={progress !== null}
            aria-label="Cerrar"
            className="eyebrow min-h-9 shrink-0 rounded-full border border-line px-3 text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            Cerrar
          </button>
        </header>

        <div className="space-y-4 p-4">
          <div
            onDragOver={(event) => {
              event.preventDefault();
              setDragging(true);
            }}
            onDragLeave={() => setDragging(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDragging(false);
              take(event.dataTransfer.files[0]);
            }}
            onClick={() => inputRef.current?.click()}
            className={classNames(
              'cursor-pointer rounded-xl border border-dashed px-4 py-8 text-center transition-colors',
              dragging ? 'bg-carbon-2' : 'hover:bg-carbon-2',
            )}
            style={{ borderColor: dragging ? GOLD : 'var(--color-line-strong)' }}
          >
            <input
              ref={inputRef}
              type="file"
              accept="video/mp4,video/webm,video/quicktime"
              hidden
              onChange={(event) => take(event.target.files?.[0])}
            />
            {file ? (
              <>
                <p className="text-fluid-sm">{file.name}</p>
                <p className="mt-1 text-fluid-xs text-ink-3">
                  {(file.size / 1024 / 1024).toFixed(1)} MB
                </p>
              </>
            ) : (
              <>
                <p className="text-fluid-sm text-ink-2">
                  Arrastrá el video acá o hacé clic
                </p>
                <p className="mt-1 text-fluid-xs text-ink-3">
                  MP4, WebM o MOV · hasta 200MB
                </p>
              </>
            )}
          </div>

          <label className="block">
            <span className="eyebrow text-ink-3">Título</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value.slice(0, 120))}
              placeholder="Pentakill con Yasuo"
              className="mt-1 w-full rounded-lg border border-line bg-void px-3 py-2 text-fluid-sm outline-none focus:border-line-strong"
            />
          </label>

          <label className="block">
            <span className="eyebrow text-ink-3">Participante (opcional)</span>
            <select
              value={playerId}
              onChange={(event) => setPlayerId(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-void px-3 py-2 text-fluid-sm outline-none focus:border-line-strong"
            >
              <option value="">Ninguno</option>
              {players.map((player) => (
                <option key={player.id} value={player.id}>
                  {player.displayName}
                </option>
              ))}
            </select>
          </label>

          {progress !== null && (
            <div>
              <div className="h-1.5 overflow-hidden rounded-full bg-carbon-3">
                <div
                  className="h-full transition-[width]"
                  style={{
                    width: `${Math.round(progress * 100)}%`,
                    backgroundColor: GOLD,
                  }}
                />
              </div>
              <p className="mt-1.5 text-fluid-xs text-ink-3">
                Subiendo… {Math.round(progress * 100)}%
              </p>
            </div>
          )}

          {error && (
            <p role="alert" className="text-fluid-xs" style={{ color: 'var(--color-mark-red)' }}>
              {error}
            </p>
          )}

          <button
            type="button"
            onClick={() => void submit()}
            disabled={!file || !title.trim() || progress !== null}
            className="eyebrow min-h-10 w-full rounded-full text-void transition-opacity hover:opacity-90 disabled:opacity-40"
            style={{ backgroundColor: GOLD }}
          >
            {progress === null ? 'Subir' : 'Subiendo…'}
          </button>
        </div>
      </div>
    </div>
  );
}
