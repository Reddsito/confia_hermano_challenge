import { useEffect, useRef, useState } from 'react';

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

/**
 * Split into two columns the way the reference sheet is laid out: schedule and
 * fair play on the left, everything match-related on the right.
 */
const RULE_COLUMNS: RuleSection[][] = [
  [
    {
      title: 'Calendario',
      items: ['Inicio: 28 de julio a las 16:00.', 'Duración: 21 días.'],
    },
    {
      title: 'Juego limpio',
      items: [
        'En tu cuenta del torneo solo puedes tener agregadas otras cuentas del torneo.',
        'Prohibido jugar fuera de stream, incluso con cuentas ajenas al torneo.',
        'Buscar partida a la vez que otros participantes para intentar coincidir está permitido, siempre en directo y con cuentas del torneo.',
        'Prohibido el coaching dentro de la partida.',
        'Prohibido estar en llamadas de Discord (o similar) mientras juegas partidas del torneo, excepto si te toca con participantes del torneo en tu mismo equipo.',
        'Chat restringido = 24h sin poder jugar.',
      ],
    },
    {
      title: 'Stream',
      items: [
        'Todas las partidas se juegan en directo y con cámara activada.',
        'Obligatorio tener el overlay del torneo puesto durante todos tus streams del SoloQ Challenge.',
        'Prohibido enseñar en directo la página de configuración de overlays (lleva tu URL con token privado). La página de Blue Shell sí puedes mostrarla, y os animamos a usarla en directo.',
        'Obligatorio publicar los VODs de todos los streams.',
      ],
    },
  ],
  [
    {
      title: 'Partidas',
      items: [
        'Sin límite de partidas.',
        'Top 5: obligatorio jugar 6+ partidas al día durante los últimos 7 días.',
      ],
    },
    {
      title: 'Bans e información',
      items: [
        'Coincides con otro participante, alguien dodgea y en la siguiente partida baneas su campeón porque puede tocarte de rival: permitido.',
        'Banear siempre el campeón de otro participante porque sabes que está jugando: permitido. Será discutible como estrategia, pero no incumple ninguna norma.',
        'PROHIBIDO usar el directo de otro participante para saber si está en tu partida, en qué equipo está o para tomar cualquier decisión dentro de ella. Eso es streamsniping.',
        'La diferencia es sencilla: información pública o deducida del matchmaking, permitido. Información sacada de un stream, prohibido.',
      ],
    },
  ],
];

/** The button and its modal travel together — the nav only renders `<RulesButton />`. */
export function RulesButton() {
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

      {open && <RulesModal onClose={() => setOpen(false)} />}
    </>
  );
}

function RulesModal({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // The page behind must not scroll while a modal is open on a phone.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Reglas del torneo"
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-4xl overflow-y-auto rounded-t-2xl border border-line bg-carbon sm:rounded-2xl"
      >
        <header
          className="sticky top-0 z-10 flex items-center gap-3 border-b border-line bg-carbon/95 p-4 backdrop-blur"
          style={{ boxShadow: `inset 0 2px 0 0 ${GOLD}` }}
        >
          <div className="min-w-0 flex-1">
            <p className="display text-fluid-lg leading-tight" style={{ color: GOLD }}>
              Reglas
            </p>
            <p className="truncate text-fluid-xs text-ink-3">
              SoloQ Challenge
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
          {RULE_COLUMNS.map((column, index) => (
            <div key={index} className="space-y-6">
              {column.map((section) => (
                <RuleBlock key={section.title} section={section} />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function RuleBlock({ section }: { section: RuleSection }) {
  return (
    <section>
      <h3 className="eyebrow flex items-center gap-2 border-b pb-2" style={{ color: GOLD, borderColor: 'var(--color-line)' }}>
        <span
          aria-hidden="true"
          className="size-1.5 shrink-0 rounded-full"
          style={{ backgroundColor: GOLD }}
        />
        {section.title}
      </h3>
      <ul className="mt-3 space-y-2.5">
        {section.items.map((item) => (
          <li key={item} className="flex gap-2 text-fluid-sm leading-relaxed text-ink-2">
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
