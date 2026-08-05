import { API_URL } from './api';

export interface Clip {
  id: string;
  title: string;
  discordId: string;
  uploaderName: string;
  uploaderAvatar: string | null;
  playerId: string | null;
  contentType: string;
  sizeBytes: number;
  duration: number | null;
  createdAt: number;
  likes: number;
  likedByMe: boolean;
  /** Public R2 URL the <video> element plays from. */
  url: string;
  /** Whether the signed-in viewer uploaded it, so delete can be offered. */
  mine: boolean;
}

export interface ClipsResponse {
  enabled: boolean;
  maxBytes: number;
  maxPerDay: number;
  clips: Clip[];
}

export type ClipSort = 'recent' | 'liked';

function authHeaders(token: string | null): Record<string, string> {
  return token ? { authorization: `Bearer ${token}` } : {};
}

async function readError(response: Response): Promise<string> {
  const body = (await response.json().catch(() => null)) as {
    error?: string;
  } | null;
  return body?.error ?? `Error ${response.status}`;
}

export async function fetchClips(
  token: string | null,
  sort: ClipSort,
): Promise<ClipsResponse> {
  const response = await fetch(`${API_URL}/api/clips?sort=${sort}`, {
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as ClipsResponse;
}

export async function toggleClipLike(
  token: string,
  clipId: string,
): Promise<{ liked: boolean; likes: number }> {
  const response = await fetch(`${API_URL}/api/clips/${clipId}/like`, {
    method: 'POST',
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(await readError(response));
  return (await response.json()) as { liked: boolean; likes: number };
}

export async function deleteClip(token: string, clipId: string): Promise<void> {
  const response = await fetch(`${API_URL}/api/clips/${clipId}`, {
    method: 'DELETE',
    headers: authHeaders(token),
  });
  if (!response.ok) throw new Error(await readError(response));
}

/**
 * Reads the duration out of the file locally, so a card can show it without the
 * server ever having to open the video.
 *
 * Resolves to null rather than rejecting: a codec the browser cannot decode for
 * metadata still uploads fine, and a missing duration is only a missing label.
 */
export function readDuration(file: File): Promise<number | null> {
  return new Promise((resolve) => {
    const url = URL.createObjectURL(file);
    const video = document.createElement('video');
    video.preload = 'metadata';

    const done = (value: number | null) => {
      URL.revokeObjectURL(url);
      resolve(value);
    };

    video.onloadedmetadata = () =>
      done(Number.isFinite(video.duration) ? video.duration : null);
    video.onerror = () => done(null);
    video.src = url;
  });
}

/**
 * Uploads straight to R2 and then registers the clip.
 *
 * XHR rather than fetch, because upload progress is the whole point: a 150MB
 * file on a home connection takes minutes, and a button that just says
 * "subiendo" for four minutes reads as broken.
 */
export async function uploadClip(
  token: string,
  file: File,
  fields: { title: string; playerId: string | null },
  onProgress: (fraction: number) => void,
): Promise<Clip['id']> {
  const signResponse = await fetch(`${API_URL}/api/clips/upload-url`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify({ contentType: file.type, sizeBytes: file.size }),
  });
  if (!signResponse.ok) throw new Error(await readError(signResponse));

  const { id, objectKey, uploadUrl } = (await signResponse.json()) as {
    id: string;
    objectKey: string;
    uploadUrl: string;
  };

  const duration = await readDuration(file);

  await new Promise<void>((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('PUT', uploadUrl);
    request.setRequestHeader('content-type', file.type);

    request.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(event.loaded / event.total);
    };
    request.onload = () =>
      request.status >= 200 && request.status < 300
        ? resolve()
        : reject(new Error(`R2 rejected the upload (${request.status}).`));
    request.onerror = () => reject(new Error('The upload was interrupted.'));
    request.onabort = () => reject(new Error('The upload was cancelled.'));

    request.send(file);
  });

  const confirmResponse = await fetch(`${API_URL}/api/clips`, {
    method: 'POST',
    headers: { ...authHeaders(token), 'content-type': 'application/json' },
    body: JSON.stringify({
      id,
      objectKey,
      title: fields.title,
      contentType: file.type,
      sizeBytes: file.size,
      duration,
      playerId: fields.playerId,
    }),
  });
  if (!confirmResponse.ok) throw new Error(await readError(confirmResponse));

  return id;
}
