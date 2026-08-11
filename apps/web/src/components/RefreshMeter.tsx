import { formatDuration, useCountdown, useMounted } from './useCountdown';
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

  // The span the ring drains over is the one the backend actually promised —
  // from this snapshot to the next — not the configured interval. The two are
  // not the same: the published moment includes the cycle's own duration, so
  // measuring against the bare interval leaves the ring pinned at full while
  // that margin runs down, which reads as a stuck meter.
  const promisedMs = Date.parse(nextUpdateAt) - Date.parse(generatedAt);
  const spanMs = Number.isFinite(promisedMs) && promisedMs > 0
    ? promisedMs
    : Math.max(intervalMinutes * 60_000, 1);
  const remaining = countdown.ready
    ? Math.min(countdown.totalMs / spanMs, 1)
    : 0;

  const mounted = useMounted();
  const ageMinutes = mounted
    ? Math.max(Math.floor((Date.now() - Date.parse(generatedAt)) / 60_000), 0)
    : 0;

  return (
    <div className="inline-flex shrink items-center gap-2.5">
      <ProgressRing ratio={remaining} pulsing={isRefreshing} />

      <div className="min-w-0 leading-tight">
        <p className="eyebrow truncate text-ink-3">
          Última actualización{' '}
          <span className="text-ink-2">
            {!mounted
              ? '…'
              : ageMinutes === 0
                ? 'recién'
                : `hace ${ageMinutes} min`}
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
              Simulado
            </span>
          )}
        </p>
        <p className="tabular text-fluid-xs">
          {!countdown.ready ? (
            <span className="text-ink-3">…</span>
          ) : countdown.expired ? (
            <span className="text-ink-2">Refreshing…</span>
          ) : (
            <>
              <span className="text-ink-3">Próxima en </span>
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
