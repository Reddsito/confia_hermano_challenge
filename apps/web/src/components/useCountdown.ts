import { useEffect, useState } from 'react';

export interface Countdown {
  totalMs: number;
  days: number;
  hours: number;
  minutes: number;
  seconds: number;
  expired: boolean;
}

function diff(targetMs: number): Countdown {
  const totalMs = Math.max(targetMs - Date.now(), 0);
  const totalSeconds = Math.floor(totalMs / 1000);

  return {
    totalMs,
    days: Math.floor(totalSeconds / 86400),
    hours: Math.floor((totalSeconds % 86400) / 3600),
    minutes: Math.floor((totalSeconds % 3600) / 60),
    seconds: totalSeconds % 60,
    expired: totalMs <= 0,
  };
}

/**
 * True only after the first client render.
 *
 * Anything derived from the current time differs between the build and the
 * browser, which is a hydration mismatch. Components use this to render a
 * stable placeholder first and the real value immediately after mounting.
 */
export function useMounted(): boolean {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  return mounted;
}

const ZERO: Countdown = {
  totalMs: 0,
  days: 0,
  hours: 0,
  minutes: 0,
  seconds: 0,
  expired: false,
};

/**
 * Ticks once per second against a target timestamp. The target comes from the
 * snapshot rather than being computed on the client, so every visitor sees the
 * same countdown regardless of when their page loaded.
 *
 * The first render is deliberately zeroed: it has to match the pre-rendered
 * HTML, which was produced at build time with a different clock.
 */
export function useCountdown(targetIso: string | null): Countdown & {
  ready: boolean;
} {
  const targetMs = targetIso ? Date.parse(targetIso) : 0;
  const [value, setValue] = useState<Countdown>(ZERO);
  const mounted = useMounted();

  useEffect(() => {
    setValue(diff(targetMs));
    const id = setInterval(() => setValue(diff(targetMs)), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  return { ...value, ready: mounted };
}

export function formatDuration(countdown: Countdown): string {
  const pad = (value: number) => String(value).padStart(2, '0');
  if (countdown.days > 0) {
    return `${countdown.days}d ${pad(countdown.hours)}h ${pad(countdown.minutes)}m`;
  }
  if (countdown.hours > 0) {
    return `${pad(countdown.hours)}:${pad(countdown.minutes)}:${pad(countdown.seconds)}`;
  }
  return `${pad(countdown.minutes)}:${pad(countdown.seconds)}`;
}
