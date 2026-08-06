import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  MAX_CHAMPION_REROLLS,
  MAX_HELD_SHELLS,
  SHELL_RULES,
  SHELL_RULE_AWARD,
  SHELL_RULE_LABEL,
  type TournamentMeta,
} from '@challenge/core/domain';

/**
 * The palette has no bright yellow — `--color-mark-amber` is a dark ochre that
 * fails contrast as text on the carbon background. The rules sheet leans on a
 * single gold accent, so it carries its own.
 */
const GOLD = '#f2c94c';

interface RuleSection {
  title: string;
  items: string[];
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('es', {
    day: 'numeric',
    month: 'long',
  });
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString('es', {
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * Built from the tournament config and the scoring module rather than typed out
 * here. A rules sheet that restates the numbers is a rules sheet that goes
 * stale the first time a threshold moves — and those thresholds have already
 * moved once.
 */
function buildSections(tournament: TournamentMeta): RuleSection[][] {
  const start = new Date(tournament.startsAt);
  const end = new Date(tournament.endsAt);
  const days = Math.round((end.getTime() - start.getTime()) / 86_400_000);

  const earning = SHELL_RULES.map((rule) => {
    const award = SHELL_RULE_AWARD[rule];
    return `${SHELL_RULE_LABEL[rule]}${award > 1 ? ` — ${award} conchas` : ''}.`;
  });

  return [
    [
      {
        title: 'Calendario',
        items: [
          `Inicio: ${formatDate(tournament.startsAt)} a las ${formatTime(tournament.startsAt)}.`,
          `Cierre: ${formatDate(tournament.endsAt)} a las ${formatTime(tournament.endsAt)}.`,
          `Duración: ${days} días.`,
          'Solo cuenta la SoloQ ranked. Flex, normales y customs no suman.',
        ],
      },
      {
        title: 'Cómo se ganan conchas',
        items: earning,
      },
    ],
    [
      {
        title: 'Cómo se tiran',
        items: [
          `Podés guardar hasta ${MAX_HELD_SHELLS} conchas sin gastar. En el tope dejás de ganar hasta tirar una.`,
          'Le tirás una concha a otro participante y le cae un reto que tiene que cumplir en su próxima partida.',
          'No podés tirarte una a vos mismo.',
        ],
      },
      {
        title: 'Los retos',
        items: [
          'El reto sale de una ruleta al momento de tirar la concha.',
          'Puede ser un reto escrito, un campeón al azar, unas runas al azar o una build de seis objetos al azar.',
          `Si te tocó un campeón, quien la tiró puede volver a girar hasta ${MAX_CHAMPION_REROLLS} veces.`,
        ],
      },
    ],
  ];
}

/** The button and its modal travel together — the nav only renders this. */
export function RulesButton({ tournament }: { tournament: TournamentMeta }) {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="eyebrow inline-flex min-h-9 shrink-0 items-center gap-2 rounded-full border px-3 transition-colors"
        style={{
          color: GOLD,
          borderColor: `color-mix(in oklab, ${GOLD} 45%, transparent)`,
          backgroundColor: `color-mix(in oklab, ${GOLD} 10%, transparent)`,
        }}
      >
        <span
          aria-hidden="true"
          className="size-1.5 rounded-full"
          style={{ backgroundColor: GOLD }}
        />
        Reglas
      </button>

      {open && (
        <RulesModal tournament={tournament} onClose={() => setOpen(false)} />
      )}
    </>
  );
}

function RulesModal({
  tournament,
  onClose,
}: {
  tournament: TournamentMeta;
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

  const columns = buildSections(tournament);

  /*
    Rendered into <body>, not where the button sits.

    The nav has `backdrop-blur-md`, and any backdrop-filter makes that element
    the containing block for fixed-position descendants. Left in place, the
    overlay resolved `inset-0` against the nav instead of the viewport, so it
    hung off the top of the page and got clipped. A portal is the fix, not more
    z-index.
  */
  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reglas del torneo"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-line bg-carbon sm:rounded-2xl"
      >
        <header
          className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-carbon/95 p-4 backdrop-blur"
          style={{ boxShadow: `inset 0 2px 0 0 ${GOLD}` }}
        >
          <div className="min-w-0 flex-1">
            <p
              className="display text-fluid-lg leading-tight"
              style={{ color: GOLD }}
            >
              Reglas
            </p>
            <p className="truncate text-fluid-xs text-ink-3">
              {tournament.name}
            </p>
          </div>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="eyebrow min-h-9 shrink-0 rounded-full border border-line px-3 text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            Cerrar
          </button>
        </header>

        <div className="grid gap-x-8 gap-y-6 p-4 sm:p-6 md:grid-cols-2">
          {columns.map((column, index) => (
            <div key={index} className="space-y-6">
              {column.map((section) => (
                <RuleBlock key={section.title} section={section} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>,
    document.body,
  );
}

function RuleBlock({ section }: { section: RuleSection }) {
  return (
    <section>
      <h3
        className="eyebrow flex items-center gap-2 border-b border-line pb-2"
        style={{ color: GOLD }}
      >
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: GOLD }}
        />
        {section.title}
      </h3>
      <ul className="mt-3 space-y-2.5">
        {section.items.map((item) => (
          <li
            key={item}
            className="flex gap-2 text-fluid-sm leading-relaxed text-ink-2"
          >
            <span aria-hidden="true" className="shrink-0 text-ink-3">
              ›
            </span>
            <span>{item}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
