import type { RankedPlayer } from '@challenge/core/domain';

/**
 * The strike, as a banner over the board instead of a page that replaces it.
 * Pure set dressing: nothing here changes how the race is scored.
 */

/** Names on the board that get the stamp. Matched on display or Riot name. */
const CORRUPT = ['beck'];

export function isCorrupt(player: Pick<RankedPlayer, 'displayName' | 'gameName'>): boolean {
  const names = [player.displayName, player.gameName].map((name) => name.toLowerCase());
  return CORRUPT.some((needle) => names.some((name) => name.startsWith(needle)));
}

/** A rubber stamp next to a name. */
export function CorruptStamp({ size = 'sm' }: { size?: 'sm' | 'lg' }) {
  return (
    <span
      title="Bajo investigación por el comité de huelga"
      className="display inline-block shrink-0 select-none align-middle leading-none uppercase"
      style={{
        color: 'var(--color-mark-red)',
        border: '2px solid var(--color-mark-red)',
        borderRadius: 3,
        padding: size === 'lg' ? '3px 7px' : '2px 5px',
        fontSize: size === 'lg' ? '0.85rem' : '0.62rem',
        letterSpacing: '0.12em',
        transform: 'rotate(-7deg)',
        boxShadow: 'inset 0 0 0 1px color-mix(in oklab, var(--color-mark-red) 35%, transparent)',
        background: 'color-mix(in oklab, var(--color-mark-red) 12%, transparent)',
        textShadow: '0 0 8px color-mix(in oklab, var(--color-mark-red) 60%, transparent)',
      }}
    >
      Corrupto
    </span>
  );
}

const PATCHES: { text: string; tilt: number; tone: 'red' | 'ink' | 'gold' }[] = [
  { text: 'No a la corrupción', tilt: -6, tone: 'red' },
  { text: 'El LP no se compra', tilt: 4, tone: 'ink' },
  { text: 'VAR para todos', tilt: -3, tone: 'gold' },
  { text: 'Becksito devolvé las conchas', tilt: 5, tone: 'red' },
  { text: 'Elo limpio ya', tilt: -4, tone: 'ink' },
  { text: 'Ni un smurf más', tilt: 3, tone: 'gold' },
];

const TONES = {
  red: 'var(--color-mark-red)',
  ink: 'var(--color-ink)',
  gold: 'var(--color-gold)',
} as const;

function Patch({ text, tilt, tone }: (typeof PATCHES)[number]) {
  const color = TONES[tone];
  return (
    <span
      className="display inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-fluid-xs uppercase"
      style={{
        color,
        transform: `rotate(${tilt}deg)`,
        border: `1.5px dashed ${color}`,
        background: `color-mix(in oklab, ${color} 10%, var(--color-carbon))`,
        letterSpacing: '0.08em',
        boxShadow: '0 2px 0 rgb(0 0 0 / 0.4)',
      }}
    >
      <span aria-hidden>✊</span>
      {text}
    </span>
  );
}

const TAPE =
  'repeating-linear-gradient(-45deg, var(--color-mark-red) 0 14px, var(--color-void) 14px 28px)';

export function StrikeBanner() {
  return (
    <section
      aria-label="Huelga"
      className="relative mb-4 overflow-hidden rounded-xl border bg-carbon"
      style={{ borderColor: 'var(--color-mark-red)' }}
    >
      <div aria-hidden className="h-2.5" style={{ background: TAPE }} />

      <div className="flex flex-col gap-4 px-4 py-5 sm:px-6 md:flex-row md:items-center md:justify-between">
        <div className="min-w-0">
          <p className="eyebrow flex items-center gap-2" style={{ color: 'var(--color-mark-red)' }}>
            <span
              aria-hidden
              className="inline-block h-2 w-2 rounded-full"
              style={{ background: 'var(--color-mark-red)', animation: 'live-pulse 1.4s infinite' }}
            />
            Bandera roja · comité de huelga
          </p>
          <h2
            className="display mt-2 leading-[0.85] uppercase"
            style={{
              color: 'var(--color-mark-red)',
              fontSize: 'clamp(2.8rem, 1.8rem + 5vw, 5.5rem)',
            }}
          >
            Huelga
          </h2>
          <p className="display mt-1 text-fluid-lg uppercase text-ink">No a la corrupción</p>
          <p className="mt-2 max-w-[48ch] text-fluid-sm text-ink-2">
            Los jugadores exigen transparencia en la ladder. La tabla sigue corriendo
            bajo protesta.
          </p>
        </div>

        <div className="flex max-w-xl flex-wrap gap-2.5 md:justify-end">
          {PATCHES.map((patch) => (
            <Patch key={patch.text} {...patch} />
          ))}
        </div>
      </div>

      <div aria-hidden className="h-2.5" style={{ background: TAPE }} />
    </section>
  );
}
