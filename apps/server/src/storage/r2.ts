import { createHash, createHmac } from 'node:crypto';

export interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  /**
   * Base URL objects are served from — an r2.dev subdomain or a custom domain
   * bound to the bucket. Playback reads straight from here, so the bucket must
   * allow public GET; only writes go through a signed URL.
   */
  publicUrl: string;
}

/** R2 ignores the region but SigV4 requires one in the credential scope. */
const REGION = 'auto';
const SERVICE = 's3';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function hmac(key: Buffer | string, value: string): Buffer {
  return createHmac('sha256', key).update(value, 'utf8').digest();
}

/**
 * Percent-encodes for SigV4, which is stricter than encodeURIComponent: it also
 * escapes ! ' ( ) *, and a mismatch here produces a signature that verifies
 * against a different string than the one the browser sends.
 */
function encodeRfc3986(value: string): string {
  return encodeURIComponent(value).replace(
    /[!'()*]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

function encodeKey(key: string): string {
  return key.split('/').map(encodeRfc3986).join('/');
}

/**
 * A presigned PUT the browser uploads to directly.
 *
 * The alternative — proxying the file through this server — would buffer a
 * 100MB video in the API process for every upload, which is exactly what the
 * box running the sync loop cannot afford. Signing a URL keeps the bytes on a
 * path that never touches us.
 *
 * Only `host` is signed. Signing content-type as well would force the browser
 * to send a byte-identical header, and a mismatch fails the upload with an
 * opaque 403; the type is validated server-side before the URL is issued and
 * the key carries the extension, which is what actually matters.
 */
export function presignPut(
  config: R2Config,
  key: string,
  expiresInSeconds = 600,
): string {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  const query = new URLSearchParams({
    'X-Amz-Algorithm': 'AWS4-HMAC-SHA256',
    'X-Amz-Credential': `${config.accessKeyId}/${scope}`,
    'X-Amz-Date': amzDate,
    'X-Amz-Expires': String(expiresInSeconds),
    'X-Amz-SignedHeaders': 'host',
  });
  // SigV4 requires the canonical query sorted by key, and URLSearchParams keeps
  // insertion order, so sort explicitly rather than relying on the literal above.
  const canonicalQuery = [...query.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([name, value]) => `${encodeRfc3986(name)}=${encodeRfc3986(value)}`)
    .join('&');

  const canonicalPath = `/${config.bucket}/${encodeKey(key)}`;
  const canonicalRequest = [
    'PUT',
    canonicalPath,
    canonicalQuery,
    `host:${host}\n`,
    'host',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), REGION), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  return `https://${host}${canonicalPath}?${canonicalQuery}&X-Amz-Signature=${signature}`;
}

/** Fire-and-forget delete, signed the same way but issued from here. */
export async function deleteObject(config: R2Config, key: string): Promise<void> {
  const host = `${config.accountId}.r2.cloudflarestorage.com`;
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${REGION}/${SERVICE}/aws4_request`;

  const canonicalRequest = [
    'DELETE',
    `/${config.bucket}/${encodeKey(key)}`,
    '',
    `host:${host}\nx-amz-content-sha256:UNSIGNED-PAYLOAD\nx-amz-date:${amzDate}\n`,
    'host;x-amz-content-sha256;x-amz-date',
    'UNSIGNED-PAYLOAD',
  ].join('\n');

  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    scope,
    sha256(canonicalRequest),
  ].join('\n');

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${config.secretAccessKey}`, dateStamp), REGION), SERVICE),
    'aws4_request',
  );
  const signature = createHmac('sha256', signingKey)
    .update(stringToSign, 'utf8')
    .digest('hex');

  await fetch(`https://${host}/${config.bucket}/${encodeKey(key)}`, {
    method: 'DELETE',
    headers: {
      authorization:
        `AWS4-HMAC-SHA256 Credential=${config.accessKeyId}/${scope}, ` +
        'SignedHeaders=host;x-amz-content-sha256;x-amz-date, ' +
        `Signature=${signature}`,
      'x-amz-content-sha256': 'UNSIGNED-PAYLOAD',
      'x-amz-date': amzDate,
    },
  });
}

/** Public playback URL for a stored object. */
export function publicUrlFor(config: R2Config, key: string): string {
  return `${config.publicUrl.replace(/\/$/, '')}/${encodeKey(key)}`;
}
