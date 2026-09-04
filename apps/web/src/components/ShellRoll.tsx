import { useEffect, useMemo, useRef, useState } from 'react';

import type {
  ItemInfo,
  RunePage,
  RuneOption,
  ShellPayload,
} from '../lib/session';
import { classNames } from './ui';

/**
 * Drawing what a blue shell rolled.
 *
 * The server has already decided by the time any of this renders — the reel is
 * theatre over a settled result, never the thing that picks it. That is what
 * makes a reload safe: replaying the animation cannot change the outcome.
 */

export interface ChampionInfo {
  id: number;
  name: string;
  icon: string;
}

interface ChampionReelProps {
  /** The champion the server drew. */
  championId: number;
  champions: Map<number, ChampionInfo>;
  /** Candidates to flick past. Falls back to the whole roster when unknown. */
  pool: number[];
  /** False replays nothing — used when showing an old throw in the history. */
  animate?: boolean;
}

/** How long the strip runs before it has to be stopped on the answer. */
const REEL_MS = 3600;
/** One tile plus its gap. The strip is positioned in multiples of this. */
const TILE = 88;
const GAP = 10;
const STEP = TILE + GAP;
/** Decoys to flick past, and where in them the real one is planted. */
const STRIP_LENGTH = 46;
const WINNER_INDEX = 39;

function prefersReducedMotion(): boolean {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * A real reel.
 *
 * The previous version was a single tile swapping its own image on a timer, so
 * the candidates never existed as a strip and there was nothing to watch go
 * past. This is the strip: every option laid out in a row, dragged left under a
 * fixed marker, and stopped with the drawn champion under it.
 *
 * The movement is one CSS transform with a long ease-out rather than a
 * per-frame React update. That keeps it on the compositor — forty images
 * animated through state would drop frames on a phone, and a reel that stutters
 * reads as broken rather than as fast.
 */
export function ChampionReel({
  championId,
  champions,
  pool,
  animate = true,
}: ChampionReelProps) {
  const viewport = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'running' | 'settled'>('settled');

  const instant = !animate;

  /**
   * Fixed for the life of the reel. Regenerating the decoys mid-spin would
   * change what is under the marker without the strip having moved.
   */
  const strip = useMemo(() => {
    const source = pool.length > 1 ? pool : [...champions.keys()];
    if (source.length === 0) return [championId];

    const items = Array.from(
      { length: STRIP_LENGTH },
      (_, index) => source[(index * 7 + 3) % source.length]!,
    );
    items[WINNER_INDEX] = championId;
    return items;
  }, [pool, champions, championId]);

  // The marker sits at the centre of the viewport, so the offset depends on how
  // wide the card actually is — which is not known until it has been laid out.
  useEffect(() => {
    const element = viewport.current;
    if (!element) return;

    const measure = () => setWidth(element.clientWidth);
    measure();

    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const target = width > 0 ? width / 2 - TILE / 2 - WINNER_INDEX * STEP : 0;

  useEffect(() => {
    if (instant || width === 0 || prefersReducedMotion()) {
      setPhase('settled');
      return;
    }

    setPhase('idle');

    // Two frames: one for the browser to paint the strip at its start position
    // with no transition, one for the transform to count as a change. Without
    // the pause the reel jumps straight to the answer.
    let outer = 0;
    let inner = 0;
    outer = requestAnimationFrame(() => {
      inner = requestAnimationFrame(() => setPhase('running'));
    });

    const stop = setTimeout(() => setPhase('settled'), REEL_MS);

    return () => {
      cancelAnimationFrame(outer);
      cancelAnimationFrame(inner);
      clearTimeout(stop);
    };
  }, [championId, instant, width]);

  const winner = champions.get(championId);
  const moving = phase === 'running';
  const placed = instant || phase !== 'idle';

  return (
    <div className="flex flex-col items-center gap-4">
      <div
        ref={viewport}
        className="relative w-full overflow-hidden rounded-2xl border border-line bg-carbon-2"
        style={{
          height: TILE + 34,
          // The strip runs off both edges rather than stopping at a border, so
          // it reads as a longer reel than the card can show.
          maskImage:
            'linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)',
          WebkitMaskImage:
            'linear-gradient(to right, transparent, #000 14%, #000 86%, transparent)',
        }}
      >
        <div
          className="flex items-start py-2"
          style={{
            gap: GAP,
            transform: `translate3d(${placed ? target : 0}px, 0, 0)`,
            transition:
              instant || phase === 'idle'
                ? 'none'
                : `transform ${REEL_MS}ms cubic-bezier(0.08, 0.82, 0.12, 1)`,
            // Knocked out of focus while it tears past, sharp once it is an
            // answer somebody has to read.
            filter: moving ? 'blur(1.4px)' : 'none',
            willChange: 'transform',
          }}
        >
          {strip.map((id, index) => {
            const champion = champions.get(id);
            const isWinner = phase === 'settled' && index === WINNER_INDEX;

            return (
              <div
                key={`${id}-${index}`}
                className="shrink-0"
                style={{ width: TILE }}
              >
                <div
                  className={classNames(
                    'grid overflow-hidden rounded-xl border transition-all duration-300',
                    isWinner ? 'border-transparent' : 'border-line',
                  )}
                  style={{
                    height: TILE,
                    opacity: phase === 'settled' && !isWinner ? 0.28 : 1,
                    boxShadow: isWinner
                      ? '0 0 0 2px var(--color-accent), 0 0 42px -8px var(--color-accent)'
                      : undefined,
                  }}
                >
                  {champion ? (
                    <img
                      src={champion.icon}
                      alt=""
                      width={TILE}
                      height={TILE}
                      draggable={false}
                      aria-hidden
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="grid h-full w-full place-items-center bg-carbon-3 text-fluid-xs text-ink-3">
                      ?
                    </span>
                  )}
                </div>

                <p
                  className={classNames(
                    'mt-1 truncate text-center text-[0.6rem] leading-tight transition-colors',
                    isWinner ? 'text-ink' : 'text-ink-3',
                  )}
                >
                  {champion?.name ?? '—'}
                </p>
              </div>
            );
          })}
        </div>

        {/* The marker. It never moves; the strip is what is dragged under it. */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-y-0 left-1/2 -translate-x-1/2"
          style={{ width: TILE + 8 }}
        >
          <span
            className="absolute inset-x-0 top-0 h-[3px]"
            style={{ background: 'var(--color-accent)' }}
          />
          <span
            className="absolute inset-x-0 bottom-0 h-[3px]"
            style={{ background: 'var(--color-accent)' }}
          />
          <span
            className="absolute inset-y-0 left-0 w-px"
            style={{
              background:
                'linear-gradient(to bottom, var(--color-accent), transparent 45%, var(--color-accent))',
            }}
          />
          <span
            className="absolute inset-y-0 right-0 w-px"
            style={{
              background:
                'linear-gradient(to bottom, var(--color-accent), transparent 45%, var(--color-accent))',
            }}
          />
        </span>
      </div>

      <p
        className={classNames(
          'display text-center transition-all duration-500',
          phase === 'settled'
            ? 'text-fluid-lg text-ink'
            : 'text-fluid-sm text-ink-3',
        )}
        // Announced only once it has stopped, so a screen reader is not read a
        // stream of champions that were never the answer.
        aria-live={phase === 'settled' ? 'polite' : 'off'}
      >
        {phase === 'settled' ? (winner?.name ?? '—') : 'Girando…'}
      </p>
    </div>
  );
}

/**
 * The rolled build, drawn as the six inventory slots it has to end up as.
 *
 * Laid out as a fixed six-slot grid rather than a list, because that is the
 * shape the punishment is checked against at the end of the game.
 */
export function BuildView({
  itemIds,
  items,
}: {
  itemIds: number[];
  items: Map<number, ItemInfo>;
}) {
  const gold = itemIds.reduce((sum, id) => sum + (items.get(id)?.gold ?? 0), 0);

  return (
    <div className="space-y-3">
      <ul className="grid grid-cols-3 gap-2 sm:grid-cols-6">
        {itemIds.map((id, index) => {
          const item = items.get(id);

          return (
            <li
              key={`${id}-${index}`}
              className="flex flex-col items-center gap-1"
            >
              <span className="grid aspect-square w-full place-items-center overflow-hidden rounded-lg border border-line bg-carbon-3">
                {item ? (
                  <img
                    src={item.icon}
                    alt={item.name}
                    title={item.name}
                    draggable={false}
                    className="h-full w-full object-cover"
                  />
                ) : (
                  <span className="text-fluid-xs text-ink-3">?</span>
                )}
              </span>
              <span className="w-full text-center text-[0.6rem] leading-tight text-ink-2">
                {item?.name ?? `#${id}`}
              </span>
            </li>
          );
        })}
      </ul>

      <p className="tabular text-fluid-xs text-ink-3">
        {gold.toLocaleString('es-AR')} de oro en total
      </p>
    </div>
  );
}

interface RunePageViewProps {
  page: RunePage;
  runes: Map<number, RuneOption>;
}

/**
 * The rolled rune page, laid out the way the client shows it: primary tree with
 * the keystone leading, secondary beside it, shards underneath.
 */
export function RunePageView({ page, runes }: RunePageViewProps) {
  const [keystone, ...minor] = page.primary;

  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <TreeColumn
        title={runes.get(page.primaryStyle)?.name ?? 'Principal'}
        icon={runes.get(page.primaryStyle)?.icon}
      >
        {keystone !== undefined && (
          <RuneBadge rune={runes.get(keystone)} size="lg" />
        )}
        <div className="flex flex-wrap gap-2">
          {minor.map((id) => (
            <RuneBadge key={id} rune={runes.get(id)} />
          ))}
        </div>
      </TreeColumn>

      <TreeColumn
        title={runes.get(page.secondaryStyle)?.name ?? 'Secundario'}
        icon={runes.get(page.secondaryStyle)?.icon}
      >
        <div className="flex flex-wrap gap-2">
          {page.secondary.map((id) => (
            <RuneBadge key={id} rune={runes.get(id)} />
          ))}
        </div>
      </TreeColumn>

      <div className="sm:col-span-2">
        <p className="eyebrow text-ink-3">Fragmentos</p>
        <ul className="mt-2 flex flex-wrap gap-2">
          {page.shards.map((id, index) => (
            <li
              key={`${id}-${index}`}
              className="rounded-full border border-line px-3 py-1 text-fluid-xs"
            >
              {SHARD_LABEL[id] ?? `#${id}`}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function TreeColumn({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="space-y-3 rounded-2xl border border-line p-4">
      <header className="flex items-center gap-2">
        {icon && <img src={icon} alt="" width={22} height={22} aria-hidden />}
        <h4 className="eyebrow">{title}</h4>
      </header>
      {children}
    </section>
  );
}

function RuneBadge({
  rune,
  size = 'sm',
}: {
  rune: RuneOption | undefined;
  size?: 'sm' | 'lg';
}) {
  const px = size === 'lg' ? 56 : 34;

  return (
    <span className="flex items-center gap-2">
      {rune?.icon ? (
        <img src={rune.icon} alt="" width={px} height={px} aria-hidden />
      ) : (
        <span
          className="rounded-full bg-line"
          style={{ width: px, height: px }}
          aria-hidden
        />
      )}
      <span
        className={classNames(
          size === 'lg' ? 'display text-fluid-base' : 'text-fluid-xs text-ink-2',
        )}
      >
        {rune?.name ?? '—'}
      </span>
    </span>
  );
}

/**
 * Shard names, spelled out here because Data Dragon does not describe them —
 * the shards belong to no tree, so nothing in the rune payload names them.
 */
const SHARD_LABEL: Record<number, string> = {
  5001: 'Salud escalada',
  5005: 'Velocidad de ataque',
  5007: 'Aceleración de habilidad',
  5008: 'Fuerza adaptable',
  5010: 'Velocidad de movimiento',
  5011: 'Salud',
  5013: 'Tenacidad',
};

/** Whichever view the payload calls for, or nothing for a plain challenge. */
export function PayloadView({
  payload,
  champions,
  runes,
  items,
  pool = [],
  animate = false,
}: {
  payload: ShellPayload | null;
  champions: Map<number, ChampionInfo>;
  runes: Map<number, RuneOption>;
  items: Map<number, ItemInfo>;
  pool?: number[];
  animate?: boolean;
}) {
  if (!payload) return null;

  if (payload.kind === 'RANDOM_CHAMPION') {
    return (
      <ChampionReel
        championId={payload.championId}
        champions={champions}
        pool={pool}
        animate={animate}
      />
    );
  }

  if (payload.kind === 'RANDOM_BUILD') {
    return <BuildView itemIds={payload.itemIds} items={items} />;
  }

  return <RunePageView page={payload.page} runes={runes} />;
}
