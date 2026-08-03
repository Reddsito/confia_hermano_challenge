import type { RankedPlayer } from '@challenge/core/domain';
import { titleCase } from '@challenge/core/domain';
import {
  Avatar,
  FormSparkline,
  OpggLink,
  ROLE_LABEL,
  StreakPill,
  classNames,
  formatPercent,
  formatSigned,
  tierColor,
} from './ui';
import { RoleIcon, TierCrest } from './icons';

const PLACE_LABEL = ['1st', '2nd', '3rd'];

/**
 * The signature block. Each card is tinted by the player's real tier, and the
 * place numeral is set oversized behind the content so the three cards read as
 * a podium at a glance rather than as three identical panels.
 */
export function Podium({
  players,
  onSelect,
}: {
  players: RankedPlayer[];
  onSelect: (player: RankedPlayer) => void;
}) {
  const top = players.slice(0, 3);
  if (top.length === 0) return null;

  return (
    <section aria-labelledby="podium-heading" className="mb-6">
      <h2 id="podium-heading" className="sr-only">
        Top tres
      </h2>
      <ol className="grid gap-3 lg:grid-cols-3">
        {top.map((player, index) => (
          <li key={player.id}>
            <PodiumCard
              player={player}
              place={index}
              onSelect={() => onSelect(player)}
            />
          </li>
        ))}
      </ol>
    </section>
  );
}

function PodiumCard({
  player,
  place,
  onSelect,
}: {
  player: RankedPlayer;
  place: number;
  onSelect: () => void;
}) {
  const accent = tierColor(player.rank);
  const leader = place === 0;

  return (
    <article
      className={classNames(
        'neon relative cursor-pointer overflow-hidden rounded-2xl border bg-carbon p-4 sm:p-5',
        leader && 'lg:p-6',
      )}
      style={{ '--tier': accent } as React.CSSProperties}
      onClick={onSelect}
    >
      {/* Oversized place numeral, clipped by the card — the signature device. */}
      <span
        aria-hidden="true"
        className="display pointer-events-none absolute -top-6 -right-3 leading-none select-none"
        style={{
          fontSize: leader ? '11rem' : '8.5rem',
          color: accent,
          opacity: 0.09,
        }}
      >
        {player.position}
      </span>

      <div className="relative flex items-start justify-between gap-3">
        <span
          className="eyebrow rounded px-2 py-1"
          style={{
            color: accent,
            background: `color-mix(in oklab, ${accent} 14%, transparent)`,
          }}
        >
          {PLACE_LABEL[place] ?? `#${player.position}`}
        </span>
        <span onClick={(event) => event.stopPropagation()}>
          <OpggLink url={player.opggUrl} />
        </span>
      </div>

      <div className="relative mt-4 flex items-center gap-3">
        <Avatar
          name={player.displayName}
          iconId={player.profileIconId}
          size={leader ? 52 : 44}
          inGame={player.inGame}
          ring={accent}
        />
        <div className="min-w-0">
          <p className="display truncate text-fluid-lg leading-tight">
            {player.displayName}
          </p>
          <p className="truncate text-fluid-xs text-ink-3">
            {player.gameName}#{player.tagLine}
          </p>
          <p className="mt-1 flex items-center gap-1 text-fluid-xs text-ink-3">
            <RoleIcon role={player.role} size={13} />
            {ROLE_LABEL[player.role]}
          </p>
        </div>
      </div>

      <div className="relative mt-5 flex items-center gap-3">
        <TierCrest rank={player.rank} size={leader ? 40 : 32} />
        <div className="min-w-0">
          <p className="eyebrow" style={{ color: accent }}>
            {player.rank
              ? `${titleCase(player.rank.tier)}${
                  player.rank.division ? ` ${player.rank.division}` : ''
                }`
              : 'Unranked'}
          </p>
          <p className="tabular flex items-baseline gap-1.5 leading-none">
            <span
              className={classNames(
                'font-semibold',
                leader ? 'text-[2.75rem]' : 'text-[2.25rem]',
              )}
            >
              {player.rank?.leaguePoints ?? 0}
            </span>
            <span className="eyebrow text-ink-3">LP</span>
          </p>
        </div>
      </div>

      <dl className="relative mt-5 grid grid-cols-3 gap-2 border-t border-line pt-3">
        <Stat
          label={`${player.totals.games} games`}
          value={`${player.totals.wins}W ${player.totals.losses}L`}
        />
        <Stat label="Winrate" value={formatPercent(player.winRate)} />
        <Stat label="LP gained" value={formatSigned(player.ladderPointsGained)} />
      </dl>

      <div className="relative mt-3 flex items-center justify-between gap-2">
        <FormSparkline results={player.recentResults} width={92} />
        <StreakPill streak={player.streak} />
      </div>

      {/* Win-rate rail: the card's one quiet quantitative flourish. */}
      <div className="relative mt-4 h-[3px] overflow-hidden rounded-full bg-carbon-3">
        <div
          className="h-full rounded-full"
          style={{
            width: `${player.winRate * 100}%`,
            background: accent,
            boxShadow: `0 0 12px 0 ${accent}`,
          }}
        />
      </div>
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <dt className="truncate text-[0.68rem] text-ink-3">{label}</dt>
      <dd className="tabular mt-0.5 truncate text-fluid-sm font-medium text-ink">
        {value}
      </dd>
    </div>
  );
}
