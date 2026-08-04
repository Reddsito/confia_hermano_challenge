import { useEffect, useMemo, useRef, useState } from 'react';

import type { RunePage, RuneOption, ShellPayload } from '../lib/session';
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

const REEL_MS = 2400;
/** Decoys shown before the real one. Enough to feel like a spin, short enough to sit through. */
const REEL_LENGTH = 24;

interface ChampionReelProps {
  /** The champion the server drew. */
  championId: number;
  champions: Map<number, ChampionInfo>;
  /** Candidates to flick past. Falls back to the whole roster when unknown. */
  pool: number[];
  /** False replays nothing — used when showing an old throw in the history. */
  animate?: boolean;
}

export function ChampionReel({
  championId,
  champions,
  pool,
  animate = true,
}: ChampionReelProps) {
  const [settled, setSettled] = useState(!animate);
  const [frame, setFrame] = useState(0);

  // The decoys are fixed for the life of the reel: regenerating them on every
  // tick would make the strip jump around instead of scrolling through.
  const decoys = useMemo(() => {
    const source = pool.length > 1 ? pool : [...champions.keys()];
    if (source.length === 0) return [];

    return Array.from(
      { length: REEL_LENGTH },
      (_, index) => source[(index * 7 + 3) % source.length]!,
    );
  }, [pool, champions]);

  const startedAt = useRef(0);

  useEffect(() => {
    if (!animate) {
      setSettled(true);
      return;
    }

    setSettled(false);
    setFrame(0);
    startedAt.current = performance.now();

    let raf = 0;
    const tick = (now: number) => {
      const progress = Math.min((now - startedAt.current) / REEL_MS, 1);
      // Eased so the strip tears past at first and crawls into place, which is
      // what makes the last name feel decided rather than merely displayed.
      const eased = 1 - (1 - progress) ** 3;
      setFrame(Math.floor(eased * REEL_LENGTH));

      if (progress < 1) raf = requestAnimationFrame(tick);
      else setSettled(true);
    };

    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [championId, animate]);

  const winner = champions.get(championId);
  const showing =
    settled || decoys.length === 0
      ? winner
      : (champions.get(decoys[frame % decoys.length]!) ?? winner);

  return (
    <div className="flex flex-col items-center gap-3">
      <div
        className={classNames(
          'relative grid h-28 w-28 place-items-center overflow-hidden rounded-2xl border transition-all duration-500',
          settled ? 'border-transparent' : 'border-line',
        )}
        style={{
          boxShadow: settled ? '0 0 48px -10px var(--color-accent)' : undefined,
        }}
      >
        {showing ? (
          <img
            src={showing.icon}
            alt={showing.name}
            width={112}
            height={112}
            className={classNames(
              'h-full w-full object-cover transition-transform',
              settled ? 'scale-100' : 'scale-110',
            )}
          />
        ) : (
          <span className="text-fluid-xs text-ink-3">…</span>
        )}
      </div>

      <p
        className={classNames(
          'display text-center transition-all duration-300',
          settled ? 'text-fluid-lg' : 'text-fluid-sm text-ink-3',
        )}
        // Announced only once it has stopped, so a screen reader is not read a
        // stream of champions that were never the answer.
        aria-live={settled ? 'polite' : 'off'}
      >
        {showing?.name ?? '—'}
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
  pool = [],
  animate = false,
}: {
  payload: ShellPayload | null;
  champions: Map<number, ChampionInfo>;
  runes: Map<number, RuneOption>;
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

  return <RunePageView page={payload.page} runes={runes} />;
}
