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
 * Ticks once per second against a target timestamp. The target comes from the
 * snapshot rather than being computed on the client, so every visitor sees the
 * same countdown regardless of when their page loaded.
 */
export function useCountdown(targetIso: string | null): Countdown {
  const targetMs = targetIso ? Date.parse(targetIso) : 0;
  const [value, setValue] = useState<Countdown>(() => diff(targetMs));

  useEffect(() => {
    setValue(diff(targetMs));
    const id = setInterval(() => setValue(diff(targetMs)), 1000);
    return () => clearInterval(id);
  }, [targetMs]);

  return value;
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
