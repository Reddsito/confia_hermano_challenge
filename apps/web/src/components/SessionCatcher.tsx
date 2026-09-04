import { useEffect, useState } from 'react';

import { captureSessionFromUrl } from '../lib/session';

/**
 * Catching a sign-in that lands on the front page.
 *
 * The backend returns from Discord to the site root with the session in the URL
 * fragment, and the root is a held front page with no dashboard on it — so
 * without this the token arrives at a page that never reads it, and signing in
 * appears to do nothing at all.
 *
 * Storing it here and forwarding keeps the redirect target a detail of the
 * server config rather than something the front page has to agree with.
 */
export function SessionCatcher({ to = '/demo' }: { to?: string }) {
  const [state, setState] = useState<'idle' | 'ok' | 'failed'>('idle');

  useEffect(() => {
    const failed = window.location.hash.includes('auth_error');
    const token = captureSessionFromUrl();

    if (token) {
      setState('ok');
      window.location.replace(to);
      return;
    }

    if (failed) {
      // Clear the marker so a reload does not report the same failure twice.
      history.replaceState(null, '', window.location.pathname);
      setState('failed');
    }
  }, [to]);

  if (state === 'idle') return null;

  return (
    <p
      role="status"
      className="eyebrow"
      style={{
        color:
          state === 'ok' ? 'var(--color-accent)' : 'var(--color-mark-red)',
      }}
    >
      {state === 'ok'
        ? 'Sesión iniciada · entrando…'
        : 'No se pudo iniciar sesión con Discord. Probá de nuevo.'}
    </p>
  );
}
