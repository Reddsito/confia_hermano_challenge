import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { ROLES, type Role } from '@challenge/core/domain';

import { SIGNUP_ENDPOINT } from '../lib/api';
import { ROLE_LABEL } from './ui';

const GOLD = '#f2c94c';

/** The group's Discord. Shown wherever someone might want in. */
export const DISCORD_INVITE = 'https://discord.gg/Hr9dpFbSa';

export function DiscordLink({ className }: { className?: string }) {
  return (
    <a
      href={DISCORD_INVITE}
      target="_blank"
      rel="noreferrer noopener"
      className={
        className ??
        'eyebrow inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-line bg-carbon/80 px-3 text-ink-2 backdrop-blur transition-colors hover:border-line-strong hover:text-ink'
      }
    >
      <DiscordIcon />
      Discord
    </a>
  );
}

function DiscordIcon() {
  return (
    <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" fill="currentColor">
      <path d="M20.3 4.4A19 19 0 0 0 15.6 3l-.2.5a17 17 0 0 1 4.1 1.4A15 15 0 0 0 12 3.6a15 15 0 0 0-7.5 1.3A17 17 0 0 1 8.6 3.5L8.4 3a19 19 0 0 0-4.7 1.4C1 8.4.4 12.3.7 16.2A19 19 0 0 0 6.4 19l1.1-1.6a12 12 0 0 1-1.9-.9l.5-.4a13 13 0 0 0 11.8 0l.5.4a12 12 0 0 1-1.9.9L17.6 19a19 19 0 0 0 5.7-2.8c.4-4.5-.6-8.4-3-11.8ZM8.4 14.2c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3Zm7.2 0c-1.1 0-2-1-2-2.3s.9-2.3 2-2.3 2 1 2 2.3-.9 2.3-2 2.3Z" />
    </svg>
  );
}

export function SignupButton() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="eyebrow inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border border-line bg-carbon/80 px-3 text-ink-2 backdrop-blur transition-colors hover:border-line-strong hover:text-ink"
      >
        Inscribirse
      </button>

      {open && <SignupModal onClose={() => setOpen(false)} />}
    </>
  );
}

function SignupModal({ onClose }: { onClose: () => void }) {
  const [gameName, setGameName] = useState('');
  const [tagLine, setTagLine] = useState('');
  const [role, setRole] = useState<Role | ''>('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !sending) onClose();
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose, sending]);

  const submit = async () => {
    if (!gameName.trim() || !tagLine.trim() || !role) return;

    setSending(true);
    setError(null);
    try {
      const response = await fetch(SIGNUP_ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ gameName, tagLine, role }),
      });
      const body = (await response.json().catch(() => null)) as {
        error?: string;
      } | null;

      if (!response.ok) throw new Error(body?.error ?? `Error ${response.status}`);
      setDone(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se pudo enviar.');
    } finally {
      setSending(false);
    }
  };

  // Portalled for the same reason the rules modal is: the nav's backdrop-blur
  // would otherwise become the containing block for this fixed overlay.
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={() => !sending && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Inscripción"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-md overflow-y-auto rounded-t-2xl border border-line bg-carbon sm:rounded-2xl"
      >
        <header
          className="flex items-center gap-3 border-b border-line p-4"
          style={{ boxShadow: `inset 0 2px 0 0 ${GOLD}` }}
        >
          <p className="display flex-1 text-fluid-lg leading-tight" style={{ color: GOLD }}>
            Inscribirse
          </p>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            disabled={sending}
            aria-label="Cerrar"
            className="eyebrow min-h-9 shrink-0 rounded-full border border-line px-3 text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-40"
          >
            Cerrar
          </button>
        </header>

        {done ? (
          <div className="space-y-4 p-6 text-center">
            <p className="display text-fluid-lg" style={{ color: GOLD }}>
              ¡Listo!
            </p>
            <p className="text-fluid-sm text-ink-2">
              Tu inscripción quedó en revisión. Entrá al Discord y avisá que te
              anotaste — ahí te confirman.
            </p>
            <DiscordLink className="eyebrow inline-flex min-h-10 items-center gap-2 rounded-full px-4 text-void transition-opacity hover:opacity-90" />
          </div>
        ) : (
          <div className="space-y-4 p-4">
            <div className="grid grid-cols-[1fr_auto] gap-2">
              <label className="block">
                <span className="eyebrow text-ink-3">Nombre de invocador</span>
                <input
                  value={gameName}
                  onChange={(event) => setGameName(event.target.value)}
                  placeholder="Rama"
                  className="mt-1 w-full rounded-lg border border-line bg-void px-3 py-2 text-fluid-sm outline-none focus:border-line-strong"
                />
              </label>
              <label className="block">
                <span className="eyebrow text-ink-3">Tag</span>
                <input
                  value={tagLine}
                  onChange={(event) => setTagLine(event.target.value)}
                  placeholder="LAN"
                  className="mt-1 w-24 rounded-lg border border-line bg-void px-3 py-2 text-fluid-sm outline-none focus:border-line-strong"
                />
              </label>
            </div>

            <label className="block">
              <span className="eyebrow text-ink-3">Rol</span>
              <select
                value={role}
                onChange={(event) => setRole(event.target.value as Role)}
                className="mt-1 w-full rounded-lg border border-line bg-void px-3 py-2 text-fluid-sm outline-none focus:border-line-strong"
              >
                <option value="">Elegí uno</option>
                {ROLES.map((option) => (
                  <option key={option} value={option}>
                    {ROLE_LABEL[option]}
                  </option>
                ))}
              </select>
            </label>

            <p className="text-fluid-xs text-ink-3">
              Se verifica tu Riot ID contra Riot al enviarlo. Después queda en
              revisión hasta que un admin lo apruebe.
            </p>

            {error && (
              <p role="alert" className="text-fluid-xs" style={{ color: 'var(--color-mark-red)' }}>
                {error}
              </p>
            )}

            <button
              type="button"
              onClick={() => void submit()}
              disabled={sending || !gameName.trim() || !tagLine.trim() || !role}
              className="eyebrow min-h-10 w-full rounded-full text-void transition-opacity hover:opacity-90 disabled:opacity-40"
              style={{ backgroundColor: GOLD }}
            >
              {sending ? 'Verificando…' : 'Enviar inscripción'}
            </button>
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}
