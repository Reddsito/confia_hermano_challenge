import { formatDuration, useCountdown } from './useCountdown';
import { classNames } from './ui';

interface RefreshMeterProps {
  generatedAt: string;
  nextUpdateAt: string;
  intervalMinutes: number;
  isRefreshing: boolean;
  source: 'mock' | 'riot';
}

/**
 * Answers two questions in one line: how stale is this, and when does it
 * change. The ring is the countdown made visible — it drains toward the next
 * refresh rather than spinning for decoration.
 */
export function RefreshMeter({
  generatedAt,
  nextUpdateAt,
  intervalMinutes,
  isRefreshing,
  source,
}: RefreshMeterProps) {
  const countdown = useCountdown(nextUpdateAt);
  const intervalMs = Math.max(intervalMinutes * 60_000, 1);
  const remaining = Math.min(countdown.totalMs / intervalMs, 1);

  const ageMinutes = Math.max(
    Math.floor((Date.now() - Date.parse(generatedAt)) / 60_000),
    0,
  );

  return (
    <div className="inline-flex shrink items-center gap-2.5">
      <ProgressRing ratio={remaining} pulsing={isRefreshing} />

      <div className="min-w-0 leading-tight">
        <p className="eyebrow truncate text-ink-3">
          Last update{' '}
          <span className="text-ink-2">
            {ageMinutes === 0 ? 'moments ago' : `${ageMinutes} min ago`}
          </span>
          {source === 'mock' && (
            <span
              className="ml-1.5 rounded px-1 py-px"
              style={{
                color: 'var(--color-mark-amber)',
                background:
                  'color-mix(in oklab, var(--color-mark-amber) 16%, transparent)',
              }}
            >
              Simulated
            </span>
          )}
        </p>
        <p className="tabular text-fluid-xs">
          {countdown.expired ? (
            <span className="text-ink-2">Refreshing…</span>
          ) : (
            <>
              <span className="text-ink-3">Next in </span>
              <span className="font-semibold">{formatDuration(countdown)}</span>
            </>
          )}
        </p>
      </div>

    </div>
  );
}

function ProgressRing({ ratio, pulsing }: { ratio: number; pulsing: boolean }) {
  const radius = 13;
  const circumference = 2 * Math.PI * radius;

  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      className={classNames('shrink-0', pulsing && 'animate-pulse')}
      aria-hidden="true"
    >
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        stroke="var(--color-carbon-3)"
        strokeWidth="2.5"
      />
      <circle
        cx="16"
        cy="16"
        r={radius}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={circumference * (1 - ratio)}
        transform="rotate(-90 16 16)"
        style={{
          transition: 'stroke-dashoffset 1s linear',
          filter: 'drop-shadow(0 0 4px var(--color-accent))',
        }}
      />
    </svg>
  );
}
