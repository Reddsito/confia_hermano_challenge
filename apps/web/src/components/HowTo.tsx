import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import { classNames } from './ui';

/**
 * A "how does this work" button, next to the thing it explains.
 *
 * The rules sheet in the header covers the whole challenge, which means the
 * three paragraphs about betting are behind a button labelled "Reglas" on a
 * page about something else. Somebody looking at the wager panel wondering what
 * a stake is will not go looking there — so each panel carries its own, opened
 * from where the question is actually asked.
 */

export interface HowToStep {
  /** The short imperative: what you do, or what happens. */
  title: string;
  body: string;
}

export function HowToButton({
  label = 'Cómo funciona',
  title,
  intro,
  steps,
  notes = [],
  accent = 'var(--color-accent)',
}: {
  label?: string;
  title: string;
  intro: string;
  steps: HowToStep[];
  /** Short lines of small print, shown under the steps. */
  notes?: string[];
  accent?: string;
}) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="eyebrow inline-flex min-h-9 shrink-0 items-center gap-2 rounded-md border px-3 transition-colors"
        style={{
          color: accent,
          borderColor: `color-mix(in oklab, ${accent} 45%, transparent)`,
          backgroundColor: `color-mix(in oklab, ${accent} 10%, transparent)`,
        }}
      >
        <QuestionMark />
        {label}
      </button>

      {open && (
        <HowToModal
          title={title}
          intro={intro}
          steps={steps}
          notes={notes}
          accent={accent}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  );
}

function HowToModal({
  title,
  intro,
  steps,
  notes,
  accent,
  onClose,
}: {
  title: string;
  intro: string;
  steps: HowToStep[];
  notes: string[];
  accent: string;
  onClose: () => void;
}) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return createPortal(
    <div
      className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-void/85 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-label={title}
      onClick={onClose}
    >
      <div
        className="my-auto w-full max-w-xl rounded-xl border bg-carbon"
        style={{
          borderColor: `color-mix(in oklab, ${accent} 30%, var(--color-line))`,
          boxShadow: `inset 3px 0 0 0 ${accent}`,
        }}
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="display text-fluid-lg leading-none">{title}</h2>
            <p className="mt-2 max-w-md text-fluid-sm text-ink-2">{intro}</p>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="eyebrow shrink-0 rounded-md border border-line px-2.5 py-1.5 text-ink-3 transition-colors hover:text-ink"
          >
            Esc
          </button>
        </header>

        {/*
          Numbered because these really are a sequence — you cannot spend a coin
          before you have one. Elsewhere on the site numbering would be
          decoration; here it carries the order.
        */}
        <ol className="px-5 py-4">
          {steps.map((step, index) => (
            <li
              key={step.title}
              className={classNames(
                'flex gap-4 py-3',
                index > 0 && 'border-t border-line',
              )}
            >
              <span
                className="tabular shrink-0 pt-0.5 text-fluid-sm"
                style={{ color: accent }}
              >
                {String(index + 1).padStart(2, '0')}
              </span>
              <div className="min-w-0">
                <p className="display text-fluid-base leading-none">
                  {step.title}
                </p>
                <p className="mt-1.5 text-fluid-sm text-ink-2">{step.body}</p>
              </div>
            </li>
          ))}
        </ol>

        {notes.length > 0 && (
          <ul className="space-y-1.5 border-t border-line px-5 py-4">
            {notes.map((note) => (
              <li key={note} className="text-fluid-xs text-ink-3">
                · {note}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  );
}

function QuestionMark() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="9.5" stroke="currentColor" strokeWidth="1.7" />
      <path
        d="M9.4 9.2a2.7 2.7 0 1 1 3.4 2.6c-.5.2-.8.6-.8 1.1v.7"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
      />
      <circle cx="12" cy="16.6" r="1.05" fill="currentColor" />
    </svg>
  );
}
