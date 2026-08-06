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

  return (
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
      className="eyebrow flex min-h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-[0.62rem] transition-colors"
      style={
        enabled
          ? {
              color: GOLD,
              borderColor: `color-mix(in oklab, ${GOLD} 45%, transparent)`,
              backgroundColor: `color-mix(in oklab, ${GOLD} 12%, transparent)`,
            }
          : {
              color: 'var(--color-ink-3)',
              borderColor: 'var(--color-line)',
            }
      }
    >
      <BellIcon muted={!enabled} />
      <span className="hidden sm:inline">Aviso</span>
    </button>
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
 * The admin bench: pick the cue, hear all five, and put the alert on a loop to
 * confirm it really fires with the tab in the background.
 */
export function SoundLab() {
  const { enabled, sound } = useNotify();
  const [looping, setLooping] = useLoop();

  return (
    <section className="rounded-2xl border border-line bg-carbon p-5">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-fluid-lg">Sonido del aviso</h3>
        <p className="text-fluid-xs text-ink-3">
          Se guarda en este navegador, no en el servidor.
        </p>
      </header>

      <p className="mt-2 text-fluid-xs text-ink-3">
        El aviso suena cuando empieza una partida.{' '}
        {enabled ? (
          <span style={{ color: GOLD }}>Está activado.</span>
        ) : (
          <>
            Ahora está <strong>apagado</strong> — prendelo con la campanita de
            arriba.
          </>
        )}
      </p>

      <ul className="mt-4 grid gap-2 sm:grid-cols-2">
        {SOUND_IDS.map((id) => {
          const cue = CUES[id];
          const chosen = id === sound;

          return (
            <li key={id}>
              <div
                className="flex items-center gap-3 rounded-xl border px-3 py-2.5 transition-colors"
                style={{
                  borderColor: chosen ? GOLD : 'var(--color-line)',
                  backgroundColor: chosen
                    ? `color-mix(in oklab, ${GOLD} 8%, transparent)`
                    : 'transparent',
                }}
              >
                <button
                  type="button"
                  onClick={() => {
                    unlock();
                    writeSound(id);
                    play(id);
                  }}
                  className="min-w-0 flex-1 text-left"
                >
                  <span
                    className="block truncate text-fluid-sm"
                    style={chosen ? { color: GOLD } : undefined}
                  >
                    {cue.label}
                  </span>
                  <span className="block truncate text-[0.62rem] text-ink-3">
                    {cue.detail}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => {
                    unlock();
                    play(id);
                  }}
                  aria-label={`Escuchar ${cue.label}`}
                  className="eyebrow min-h-8 shrink-0 rounded-full border border-line px-3 text-[0.6rem] text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
                >
                  Probar
                </button>
              </div>
            </li>
          );
        })}
      </ul>

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
