import { useEffect, useRef, useState, useSyncExternalStore } from 'react';

import {
  CUES,
  SOUND_IDS,
  play,
  readEnabled,
  readSound,
  subscribe,
  unlock,
  writeEnabled,
  writeSound,
  type SoundId,
} from '../lib/sound';

const GOLD = '#f2c94c';

/** Reads the settings and re-renders whichever component is showing them. */
export function useNotify(): { enabled: boolean; sound: SoundId } {
  const enabled = useSyncExternalStore(subscribe, readEnabled, () => false);
  const sound = useSyncExternalStore(subscribe, readSound, () => 'coin' as const);
  return { enabled, sound };
}

/**
 * The bell in the nav.
 *
 * Turning it on is what unlocks audio: browsers refuse to start an audio
 * context outside a user gesture, so without a real click the alert would fail
 * silently the first time a game started. The confirmation blip doubles as
 * proof that the volume is up.
 */
export function NotifyButton() {
  const { enabled, sound } = useNotify();
  const [open, setOpen] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  // A menu that only closes by picking something is a trap on a phone, where
  // there is no Escape key.
  useEffect(() => {
    if (!open) return;

    const onDown = (event: PointerEvent) => {
      if (!boxRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setOpen(false);
    };

    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const tone = enabled
    ? {
        color: GOLD,
        borderColor: `color-mix(in oklab, ${GOLD} 45%, transparent)`,
        backgroundColor: `color-mix(in oklab, ${GOLD} 12%, transparent)`,
      }
    : { color: 'var(--color-ink-3)', borderColor: 'var(--color-line)' };

  return (
    <div ref={boxRef} className="relative shrink-0">
      <div
        className="flex min-h-9 items-center rounded-full border"
        style={tone}
      >
        <button
          type="button"
          onClick={() => {
            unlock();
            const next = !enabled;
            writeEnabled(next);
            if (next) play(sound);
          }}
          aria-pressed={enabled}
          title={
            enabled
              ? 'Suena cuando empieza una partida. Click para silenciar.'
              : 'Activá el aviso sonoro cuando empieza una partida.'
          }
          className="eyebrow flex min-h-9 items-center gap-1.5 rounded-l-full pr-2 pl-3 text-[0.62rem]"
        >
          <BellIcon muted={!enabled} />
          <span className="hidden sm:inline">Aviso</span>
        </button>

        <button
          type="button"
          onClick={() => {
            unlock();
            setOpen(!open);
          }}
          aria-expanded={open}
          aria-label="Elegir el sonido del aviso"
          title="Elegir el sonido"
          className="flex min-h-9 items-center rounded-r-full border-l pr-2.5 pl-2"
          style={{ borderColor: 'inherit' }}
        >
          <svg
            viewBox="0 0 24 24"
            width={11}
            height={11}
            fill="none"
            stroke="currentColor"
            strokeWidth={2.5}
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
            style={{
              transform: open ? 'rotate(180deg)' : undefined,
              transition: 'transform 120ms',
            }}
          >
            <path d="m6 9 6 6 6-6" />
          </svg>
        </button>
      </div>

      {open && (
        <div className="absolute right-0 top-[calc(100%+0.4rem)] z-30 w-60 overflow-hidden rounded-xl border border-line bg-carbon shadow-xl">
          <p className="eyebrow border-b border-line px-3 py-2 text-[0.58rem] text-ink-3">
            Sonido del aviso
          </p>
          <ul className="max-h-[60dvh] overflow-y-auto">
            {SOUND_IDS.map((id) => {
              const chosen = id === sound;
              return (
                <li key={id}>
                  {/* Choosing plays it: picking a sound you cannot hear first
                      is picking blind. */}
                  <button
                    type="button"
                    onClick={() => {
                      unlock();
                      writeSound(id);
                      play(id);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left transition-colors hover:bg-carbon-2"
                    style={chosen ? { color: GOLD } : undefined}
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 shrink-0 rounded-full"
                      style={{
                        backgroundColor: chosen ? GOLD : 'transparent',
                        boxShadow: chosen
                          ? undefined
                          : 'inset 0 0 0 1px var(--color-line-strong)',
                      }}
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-fluid-xs">
                        {CUES[id].label}
                      </span>
                      <span className="block truncate text-[0.58rem] text-ink-3">
                        {CUES[id].detail}
                      </span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

function BellIcon({ muted }: { muted: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={13}
      height={13}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
      <path d="M13.7 21a2 2 0 0 1-3.4 0" />
      {muted && <path d="M3 3l18 18" />}
    </svg>
  );
}

/**
 * The admin test bench.
 *
 * Only the loop lives here. Which cue you hear is a personal preference, so it
 * belongs next to the bell where everyone can reach it — not behind the admin
 * code, where only one person could choose and everyone else was stuck with the
 * default.
 */
export function SoundLab() {
  const { enabled, sound } = useNotify();
  const [looping, setLooping] = useLoop();

  return (
    <section className="rounded-2xl border border-line bg-carbon p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-fluid-lg">Probar el aviso</h3>
        <p className="text-fluid-xs text-ink-3">
          Sonando: {CUES[sound].label}
        </p>
      </header>

      <p className="mt-2 text-fluid-xs text-ink-3">
        El aviso suena cuando empieza una partida.{' '}
        {enabled ? (
          <span style={{ color: GOLD }}>Está activado.</span>
        ) : (
          <>
            Ahora está <strong>apagado</strong> — prendelo con la campanita de
            arriba, y elegí el sonido en la flechita de al lado.
          </>
        )}
      </p>

      <div className="mt-4 flex flex-wrap items-center gap-3 rounded-xl border border-line bg-void px-3 py-3">
        <div className="min-w-0 flex-1">
          <p className="text-fluid-sm">Repetir cada 10 segundos</p>
          <p className="text-[0.62rem] text-ink-3">
            Para comprobar que suena con la pestaña en segundo plano. Cambiá de
            pestaña y esperá.
          </p>
        </div>

        <button
          type="button"
          onClick={() => {
            unlock();
            setLooping(!looping);
          }}
          aria-pressed={looping}
          className="eyebrow min-h-10 shrink-0 rounded-full px-4 text-[0.62rem] transition-colors"
          style={
            looping
              ? { backgroundColor: 'var(--color-mark-red)', color: '#05070a' }
              : { backgroundColor: GOLD, color: '#05070a' }
          }
        >
          {looping ? 'Parar' : 'Arrancar'}
        </button>
      </div>
    </section>
  );
}

const LOOP_MS = 10_000;

/**
 * The test loop.
 *
 * It reads the chosen cue at fire time through a ref, so switching sounds while
 * it runs takes effect on the next beat instead of restarting the interval.
 */
function useLoop(): [boolean, (on: boolean) => void] {
  const { sound } = useNotify();
  const [looping, setLooping] = useState(false);
  const soundRef = useRef(sound);
  soundRef.current = sound;

  useEffect(() => {
    if (!looping) return;
    play(soundRef.current);
    const id = setInterval(() => play(soundRef.current), LOOP_MS);
    return () => clearInterval(id);
  }, [looping]);

  return [looping, setLooping];
}
