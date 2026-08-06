/**
 * The alert sounds.
 *
 * Every one of these is a handful of square-wave notes, which is literally what
 * the consoles they are quoting did — so a table of frequencies reproduces them
 * more faithfully than a compressed sample would, and costs no bytes to ship.
 * Cues backed by a real recording are the exception; see `Cue`.
 */

export type SoundId =
  | 'coin'
  | 'ring'
  | 'oneup'
  | 'secret'
  | 'powerup'
  | 'fanfare'
  | 'jump'
  | 'pipe'
  | 'waka'
  | 'alarm'
  | 'select'
  | 'victory';

interface Note {
  /** Hz. */
  hz: number;
  /** Seconds from the start of the cue. */
  at: number;
  /** Seconds. */
  hold: number;
}

interface Common {
  label: string;
  detail: string;
}

interface Synth extends Common {
  kind?: 'synth';
  wave: OscillatorType;
  notes: Note[];
}

interface Sample extends Common {
  kind: 'sample';
  /** Path under `public/`, e.g. `/sounds/hey.mp3`. */
  src: string;
}

/**
 * A cue is either notes we synthesize or a file we play.
 *
 * Chiptune blips are a handful of square-wave notes, so a frequency table
 * reproduces them exactly and costs nothing to ship. Anything with a *voice* in
 * it — Navi yelling, an announcer — is a recording; no oscillator will ever
 * approximate it, so those must arrive as a file under `public/sounds/`.
 */
type Cue = Synth | Sample;

/** Equal temperament from A4, so the tables below can be written as note names. */
const HZ = {
  C4: 261.63, E4: 329.63, G4: 392, GS4: 415.3, A4: 440, B4: 493.88,
  C5: 523.25, D5: 587.33, DS5: 622.25, E5: 659.25, F5: 698.46, FS5: 739.99,
  G5: 783.99, GS5: 830.61, A5: 880, AS5: 932.33, B5: 987.77,
  C6: 1046.5, D6: 1174.66, DS6: 1244.51, E6: 1318.51, F6: 1396.91,
  G6: 1567.98, A6: 1760, B6: 1975.53,
  C7: 2093, E7: 2637.02,
} as const;

/** `at` and `hold` in seconds; the whole cue is under a second by design. */
export const CUES: Record<SoundId, Cue> = {
  coin: {
    label: 'Moneda de Mario',
    detail: 'Blip corto y nota alta sostenida.',
    wave: 'square',
    notes: [
      { hz: HZ.B5, at: 0, hold: 0.08 },
      { hz: HZ.E6, at: 0.08, hold: 0.5 },
    ],
  },
  ring: {
    label: 'Anillo de Sonic',
    detail: 'Dos tonos brillantes, casi encimados.',
    wave: 'sine',
    notes: [
      { hz: HZ.E6, at: 0, hold: 0.1 },
      { hz: HZ.B6, at: 0.05, hold: 0.16 },
      { hz: HZ.E7, at: 0.11, hold: 0.22 },
    ],
  },
  oneup: {
    label: '1-UP',
    detail: 'La vida extra. Seis notas que suben.',
    wave: 'square',
    notes: [
      { hz: HZ.E5, at: 0, hold: 0.12 },
      { hz: HZ.G5, at: 0.12, hold: 0.12 },
      { hz: HZ.E6, at: 0.24, hold: 0.12 },
      { hz: HZ.C6, at: 0.36, hold: 0.12 },
      { hz: HZ.D6, at: 0.48, hold: 0.12 },
      { hz: HZ.G6, at: 0.6, hold: 0.28 },
    ],
  },
  secret: {
    label: 'Secreto de Zelda',
    detail: 'Encontraste algo. Ocho notas.',
    wave: 'triangle',
    notes: [
      { hz: HZ.G5, at: 0, hold: 0.11 },
      { hz: HZ.FS5, at: 0.11, hold: 0.11 },
      { hz: HZ.DS5, at: 0.22, hold: 0.11 },
      { hz: HZ.A4, at: 0.33, hold: 0.11 },
      { hz: HZ.GS4, at: 0.44, hold: 0.11 },
      { hz: HZ.E5, at: 0.55, hold: 0.11 },
      { hz: HZ.B5, at: 0.66, hold: 0.11 },
      { hz: HZ.C6, at: 0.77, hold: 0.4 },
    ],
  },
  powerup: {
    label: 'Power-up',
    detail: 'Arpegio que trepa. El más largo.',
    wave: 'square',
    notes: [
      { hz: HZ.C5, at: 0, hold: 0.05 },
      { hz: HZ.G5, at: 0.05, hold: 0.05 },
      { hz: HZ.C6, at: 0.1, hold: 0.05 },
      { hz: HZ.E5, at: 0.15, hold: 0.05 },
      { hz: HZ.B5, at: 0.2, hold: 0.05 },
      { hz: HZ.E6, at: 0.25, hold: 0.05 },
      { hz: HZ.G5, at: 0.3, hold: 0.05 },
      { hz: HZ.D6, at: 0.35, hold: 0.05 },
      { hz: HZ.G6, at: 0.4, hold: 0.22 },
    ],
  },
  fanfare: {
    label: 'Cofre de Zelda',
    detail: 'La fanfarria de cuando abrís el cofre.',
    wave: 'triangle',
    notes: [
      { hz: HZ.A5, at: 0, hold: 0.13 },
      { hz: HZ.AS5, at: 0.13, hold: 0.13 },
      { hz: HZ.B5, at: 0.26, hold: 0.13 },
      { hz: HZ.C6, at: 0.39, hold: 0.55 },
    ],
  },
  jump: {
    label: 'Salto',
    detail: 'Un barrido corto para arriba. El más discreto.',
    wave: 'square',
    notes: [
      { hz: HZ.C5, at: 0, hold: 0.04 },
      { hz: HZ.G5, at: 0.04, hold: 0.04 },
      { hz: HZ.C6, at: 0.08, hold: 0.04 },
      { hz: HZ.E6, at: 0.12, hold: 0.12 },
    ],
  },
  pipe: {
    label: 'Bajar al tubo',
    detail: 'Va para abajo en vez de para arriba.',
    wave: 'square',
    notes: [
      { hz: HZ.C6, at: 0, hold: 0.05 },
      { hz: HZ.G5, at: 0.05, hold: 0.05 },
      { hz: HZ.E5, at: 0.1, hold: 0.05 },
      { hz: HZ.C5, at: 0.15, hold: 0.05 },
      { hz: HZ.G4, at: 0.2, hold: 0.05 },
      { hz: HZ.C4, at: 0.25, hold: 0.18 },
    ],
  },
  waka: {
    label: 'Pac-Man',
    detail: 'Cuatro mordiscos.',
    wave: 'square',
    notes: [
      { hz: HZ.C5, at: 0, hold: 0.05 },
      { hz: HZ.C6, at: 0.06, hold: 0.05 },
      { hz: HZ.C5, at: 0.14, hold: 0.05 },
      { hz: HZ.C6, at: 0.2, hold: 0.05 },
      { hz: HZ.C5, at: 0.28, hold: 0.05 },
      { hz: HZ.C6, at: 0.34, hold: 0.05 },
    ],
  },
  alarm: {
    label: 'Alarma de caparazón',
    detail: 'Dos tonos alternados. El más molesto, a propósito.',
    wave: 'sawtooth',
    notes: [
      { hz: HZ.E6, at: 0, hold: 0.12 },
      { hz: HZ.B5, at: 0.14, hold: 0.12 },
      { hz: HZ.E6, at: 0.28, hold: 0.12 },
      { hz: HZ.B5, at: 0.42, hold: 0.12 },
      { hz: HZ.E6, at: 0.56, hold: 0.2 },
    ],
  },
  select: {
    label: 'Blip de menú',
    detail: 'Una nota y listo. Para el que no quiere melodía.',
    wave: 'square',
    notes: [{ hz: HZ.E6, at: 0, hold: 0.09 }],
  },
  victory: {
    label: 'Victoria',
    detail: 'Tres golpes y una nota larga. Épico y corto.',
    wave: 'square',
    notes: [
      { hz: HZ.C6, at: 0, hold: 0.09 },
      { hz: HZ.C6, at: 0.12, hold: 0.09 },
      { hz: HZ.C6, at: 0.24, hold: 0.09 },
      { hz: HZ.GS5, at: 0.36, hold: 0.14 },
      { hz: HZ.DS6, at: 0.5, hold: 0.1 },
      { hz: HZ.C6, at: 0.6, hold: 0.1 },
      { hz: HZ.F6, at: 0.7, hold: 0.45 },
    ],
  },
};

export const SOUND_IDS = Object.keys(CUES) as SoundId[];

export const DEFAULT_SOUND: SoundId = 'coin';

const ENABLED_KEY = 'notify.enabled';
const SOUND_KEY = 'notify.sound';

export function isSoundId(value: string | null): value is SoundId {
  return value !== null && value in CUES;
}

export function readEnabled(): boolean {
  try {
    return localStorage.getItem(ENABLED_KEY) === '1';
  } catch {
    return false;
  }
}

export function writeEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(ENABLED_KEY, enabled ? '1' : '0');
  } catch {
    /* Private mode. The toggle still works for this session. */
  }
  announce();
}

export function readSound(): SoundId {
  try {
    const stored = localStorage.getItem(SOUND_KEY);
    return isSoundId(stored) ? stored : DEFAULT_SOUND;
  } catch {
    return DEFAULT_SOUND;
  }
}

export function writeSound(id: SoundId): void {
  try {
    localStorage.setItem(SOUND_KEY, id);
  } catch {
    /* As above. */
  }
  announce();
}

/**
 * Both the nav bell and the panel picker write these settings, and they can be
 * on screen at the same time, so the writes are broadcast rather than read once
 * on mount.
 */
const listeners = new Set<() => void>();

export function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function announce(): void {
  for (const listener of listeners) listener();
}

let context: AudioContext | null = null;

function audio(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctor =
    window.AudioContext ??
    (window as unknown as { webkitAudioContext?: typeof AudioContext })
      .webkitAudioContext;
  if (!Ctor) return null;
  context ??= new Ctor();
  return context;
}

/**
 * Wakes the audio context.
 *
 * Browsers start it suspended and only allow a resume from inside a user
 * gesture, so this MUST be called from a click handler — not from an effect,
 * not from a timer. Once resumed it stays resumed, including while the tab is
 * in the background, which is the whole point.
 */
export function unlock(): void {
  void audio()?.resume();
}

export function play(id: SoundId = readSound(), volume = 0.22): void {
  const ctx = audio();
  if (!ctx) return;
  // A tab that was backgrounded before the first cue can find the context
  // suspended again; resuming here is free when it is already running.
  void ctx.resume();

  const cue = CUES[id];

  // A recorded cue is a file, not an oscillator. It rides the same enable and
  // unlock rules; only the playback differs.
  if (cue.kind === 'sample') {
    const element = new Audio(cue.src);
    element.volume = Math.min(volume * 3, 1);
    void element.play().catch(() => {
      /* Missing file or a browser that refused. Silence beats a crash. */
    });
    return;
  }

  const start = ctx.currentTime + 0.02;

  for (const note of cue.notes) {
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    oscillator.type = cue.wave;
    oscillator.frequency.value = note.hz;

    const from = start + note.at;
    const to = from + note.hold;
    // A hard start and stop on a square wave clicks; the ramps are what make
    // this read as a chiptune blip instead of a pop.
    gain.gain.setValueAtTime(0, from);
    gain.gain.linearRampToValueAtTime(volume, from + 0.008);
    gain.gain.exponentialRampToValueAtTime(0.0001, to);

    oscillator.connect(gain).connect(ctx.destination);
    oscillator.start(from);
    oscillator.stop(to + 0.02);
  }
}
