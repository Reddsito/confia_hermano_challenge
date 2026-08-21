import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

import {
  BET_MARKET_LABEL,
  OFFERED_MARKETS,
  BET_WINDOW_SECONDS,
  MAX_CHAMPION_REROLLS,
  COIN_WALLET_CAP,
  MAX_HELD_SHELLS,
  MAX_STAKE,
  MIN_STAKE,
  PLAYER_DAILY_EARN_CAP,
  PLAYER_DAILY_GRANT,
  PLAYER_WIN_GRANT,
  SHELL_PRICE_COINS,
  SPECTATOR_DAILY_GRANT,
  SHELL_RETRIBUTION_LABEL,
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

/**
 * The only hand-written rules on this sheet. Everything else is computed from
 * the modules that enforce it, precisely so it cannot go stale — these have
 * nothing enforcing them, so they are plain text and edited right here.
 */
const PLAY_RULES = [
  'Jugás con tu cuenta, la que inscribiste. Nada de cuentas prestadas ni compartidas.',
  'La cuenta arranca desde donde esté: no hay reseteo ni elo de partida igual para todos.',
  'Si te toca de rival o de aliado otro participante, se juega normal. No se pactan partidas ni se regalan.',
  'Dodgear para esquivar un reto de concha no vale. El reto sigue pendiente para la próxima.',
  'Un remake no cuenta para nada: ni suma, ni resta, ni cumple un reto.',
  'El reto de una concha se cumple en la siguiente partida que juegues, no cuando te venga bien.',
  'Si te salteás el reto de una concha, después lo tenés que cumplir dos veces.',
  'Podés jugar en duo con quien quieras, pero el ranking es individual.',
];

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

  // Listed by hand because it is not in SHELL_RULES: no partida can satisfy it,
  // so it has no entry to be generated from.
  earning.push(
    `${SHELL_RETRIBUTION_LABEL} y ganás una. La cuenta arranca de nuevo cada vez que cobrás, y si estabas en el tope se pierde igual.`,
  );

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
        title: 'Cómo se juega',
        items: PLAY_RULES,
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
      {
        title: 'Monedas',
        items: [
          'Las apuestas se pagan en monedas, no en conchas.',
          `Ganás ${PLAYER_DAILY_GRANT} moneda por día y ${PLAYER_WIN_GRANT} por cada partida que ganes, hasta ${PLAYER_DAILY_EARN_CAP} por día. El día cierra a medianoche, hora de Panamá.`,
          `El tope de la billetera es ${COIN_WALLET_CAP} monedas. Lo que se pase se quema, incluso ganando apuestas.`,
          `Una concha azul cuesta ${SHELL_PRICE_COINS} monedas.`,
        ],
      },
      {
        title: 'Apuestas',
        items: [
          `Apostás monedas a las partidas de los demás, nunca a la tuya. ${MIN_STAKE} o ${MAX_STAKE} por partida.`,
          'Una sola apuesta por partida. Si dos del roster están en la misma, sigue siendo una.',
          `Solo durante los primeros ${Math.round(BET_WINDOW_SECONDS / 60)} minutos de la partida.`,
          `Por ahora se apuesta a una sola cosa: ${OFFERED_MARKETS.map((market) => BET_MARKET_LABEL[market].replace(/^¿|\?$/g, '').toLowerCase()).join(', ')}.`,
          'Si acertás cobrás lo que arriesgaste más la ganancia.',
          'No podés apostar lo que no tenés. Acá no se debe nada.',
          'Todo lo que apuesta cada uno se ve en la pestaña En vivo.',
        ],
      },
      {
        title: 'Espectadores',
        items: [
          'No juegan, solo apuestan. No hace falta cuenta de LoL, solo Discord.',
          `Ganan ${SPECTATOR_DAILY_GRANT} monedas por día, y ese ingreso se corta al llegar a ${COIN_WALLET_CAP}.`,
          'Ganando apuestas sí pueden pasarse del tope: es su única forma de despegar.',
          'No ganan conchas por logros. Las compran con monedas y se las pueden tirar a cualquiera del torneo.',
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
