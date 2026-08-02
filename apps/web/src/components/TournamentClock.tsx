import type { TournamentMeta } from '@challenge/core/domain';
import { useCountdown } from './useCountdown';

/**
 * Header pill: the deadline is the one number that frames everything else on
 * the page, so it sits beside the title rather than in a section of its own.
 */
export function TournamentClock({
  tournament,
}: {
  tournament: TournamentMeta;
}) {
  const countdown = useCountdown(tournament.endsAt);
  const notStarted = Date.now() < Date.parse(tournament.startsAt);

  const segments = [
    { label: 'd', value: countdown.days },
    { label: 'h', value: countdown.hours },
    { label: 'm', value: countdown.minutes },
    { label: 's', value: countdown.seconds },
  ];

  return (
    <div className="inline-flex shrink items-center gap-2 rounded-full border border-line bg-carbon/80 px-3 py-2 backdrop-blur sm:gap-3 sm:px-4">
      <span
        aria-hidden="true"
        className="h-2 w-2 shrink-0 rounded-full"
        style={{
          background: 'var(--color-accent)',
          boxShadow: '0 0 10px 0 var(--color-accent)',
        }}
      />
      <span className="eyebrow hidden leading-tight text-ink-3 sm:inline">
        {countdown.expired
          ? 'Challenge over'
          : notStarted
            ? 'Starts in'
            : 'Ends in'}
      </span>

      {countdown.expired ? (
        <span className="display text-fluid-sm">Final standings</span>
      ) : (
        <span className="flex items-baseline gap-1">
          {segments.map((segment, index) => (
            <span key={segment.label} className="flex items-baseline">
              <span className="tabular text-fluid-lg leading-none font-semibold">
                {String(segment.value).padStart(2, '0')}
              </span>
              <span className="ml-0.5 text-[0.65rem] text-ink-3">
                {segment.label}
              </span>
              {index < segments.length - 1 && (
                <span className="mx-1 text-ink-3" aria-hidden="true">
                  :
                </span>
              )}
            </span>
          ))}
        </span>
      )}
    </div>
  );
}

/** Thin bar showing how much of the challenge window has elapsed. */
export function TournamentProgress({
  tournament,
}: {
  tournament: TournamentMeta;
}) {
  const start = Date.parse(tournament.startsAt);
  const end = Date.parse(tournament.endsAt);
  const span = Math.max(end - start, 1);
  const progress = Math.min(Math.max(Date.now() - start, 0), span) / span;

  return (
    <div className="flex items-center gap-3">
      <span className="eyebrow shrink-0 text-ink-3">
        {formatDate(tournament.startsAt)}
      </span>
      <div
        className="h-[3px] flex-1 overflow-hidden rounded-full bg-carbon-3"
        role="img"
        aria-label={`${Math.round(progress * 100)} percent of the challenge elapsed`}
      >
        <div
          className="h-full rounded-full"
          style={{
            width: `${progress * 100}%`,
            background:
              'linear-gradient(90deg, var(--color-accent-deep), var(--color-accent))',
            boxShadow: '0 0 12px 0 var(--color-accent)',
          }}
        />
      </div>
      <span className="eyebrow shrink-0 text-ink-3">
        {formatDate(tournament.endsAt)}
      </span>
    </div>
  );
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    day: '2-digit',
    month: 'short',
  });
}
