import { useEffect, useRef } from 'react';

import { titleCase, type RankedPlayer, type Snapshot } from '@challenge/core/domain';

import { RoleIcon, TierCrest } from './icons';
import {
  Avatar,
  FormSparkline,
  OpggLink,
  ROLE_LABEL,
  StreakPill,
  championIconUrl,
  formatPercent,
  formatSigned,
  tierColor,
} from './ui';

function formatDuration(seconds: number): string {
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, '0')}m`;
}

function formatCompact(value: number): string {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(Math.round(value));
}

interface PlayerDetailProps {
  player: RankedPlayer;
  snapshot: Snapshot;
  allPlayers: RankedPlayer[];
  onClose: () => void;
}

/**
 * A modal dialog rather than a route: the standings stay in place behind it, so
 * closing returns you exactly where you were in a long table.
 */
export function PlayerDetail({
  player,
  snapshot,
  allPlayers,
  onClose,
}: PlayerDetailProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const accent = tierColor(player.rank);
  const extras = player.extras;

  useEffect(() => {
    closeRef.current?.focus();

    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);

    // The page behind must not scroll while a modal is open on a phone.
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const rivals = snapshot.headToHead
    .filter((row) => row.playerA === player.id || row.playerB === player.id)
    .map((row) => {
      const isA = row.playerA === player.id;
      const otherId = isA ? row.playerB : row.playerA;
      const other = allPlayers.find((candidate) => candidate.id === otherId);
      return {
        other,
        against: row.against,
        wins: isA ? row.aWonAgainst : row.against - row.aWonAgainst,
        together: row.together,
        togetherWins: row.togetherWins,
      };
    })
    .filter((row) => row.other);

  const bestDay = snapshot.dailyDeltas
    .filter((row) => row.playerId === player.id)
    .sort((a, b) => b.delta - a.delta)[0];
  const worstDay = snapshot.dailyDeltas
    .filter((row) => row.playerId === player.id)
    .sort((a, b) => a.delta - b.delta)[0];

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-void/80 p-0 backdrop-blur-sm sm:items-center sm:p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Stats for ${player.displayName}`}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-3xl overflow-y-auto rounded-t-2xl border border-line bg-carbon sm:rounded-2xl"
        style={{ '--tier': accent } as React.CSSProperties}
      >
        <header
          className="sticky top-0 z-10 flex items-start gap-3 border-b border-line bg-carbon/95 p-4 backdrop-blur"
          style={{ boxShadow: `inset 0 2px 0 0 ${accent}` }}
        >
          <Avatar
            name={player.displayName}
            iconId={player.profileIconId}
            size={48}
            inGame={player.inGame}
            ring={accent}
          />
          <div className="min-w-0 flex-1">
            <p className="display truncate text-fluid-lg leading-tight">
              {player.displayName}
            </p>
            <p className="truncate text-fluid-xs text-ink-3">
              {player.gameName}#{player.tagLine}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-fluid-xs text-ink-2">
              <RoleIcon role={player.role} size={13} />
              {ROLE_LABEL[player.role]}
              <span className="text-ink-3">· #{player.position}</span>
            </p>
          </div>

          <button
            ref={closeRef}
            type="button"
            onClick={onClose}
            aria-label="Cerrar"
            className="eyebrow min-h-9 shrink-0 rounded-full border border-line px-3 text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
          >
            Close
          </button>
        </header>

        <div className="space-y-5 p-4">
          <section className="flex flex-wrap items-center gap-4">
            <TierCrest rank={player.rank} size={44} />
            <div>
              <p className="eyebrow" style={{ color: accent }}>
                {player.rank
                  ? `${titleCase(player.rank.tier)}${player.rank.division ? ` ${player.rank.division}` : ''}`
                  : 'Unranked'}
              </p>
              <p className="tabular text-[2rem] leading-none font-semibold">
                {player.rank?.leaguePoints ?? 0}
                <span className="eyebrow ml-1.5 text-ink-3">LP</span>
              </p>
            </div>
            <div className="ml-auto flex items-center gap-3">
              <FormSparkline results={player.recentResults} width={110} height={34} />
              <StreakPill streak={player.streak} />
              <OpggLink url={player.opggUrl} />
            </div>
          </section>

          <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Stat label="Record" value={`${player.totals.wins}W ${player.totals.losses}L`} />
            <Stat label="Winrate" value={formatPercent(player.winRate, 1)} />
            <Stat label="KDA" value={player.kda.toFixed(2)} />
            <Stat label="LP gained" value={formatSigned(player.ladderPointsGained)} />
            <Stat
              label="K / D / A"
              value={`${player.totals.kills} / ${player.totals.deaths} / ${player.totals.assists}`}
            />
            <Stat label="CS per min" value={player.csPerMinute.toFixed(1)} />
            <Stat
              label="Horas jugadas"
              value={(player.totals.minutesPlayed / 60).toFixed(1)}
            />
            <Stat
              label="Kill participation"
              value={
                extras?.killParticipation !== null && extras?.killParticipation !== undefined
                  ? formatPercent(extras.killParticipation)
                  : '—'
              }
            />
          </dl>

          {extras && (
            <section>
              <h3 className="eyebrow mb-2 text-ink-3">The details</h3>
              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat label="Time spent dead" value={formatDuration(extras.timeDeadSeconds)} />
                <Stat label="Damage dealt" value={formatCompact(extras.damageToChampions)} />
                <Stat label="Damage taken" value={formatCompact(extras.damageTaken)} />
                <Stat label="Gold earned" value={formatCompact(extras.goldEarned)} />
                <Stat label="Vision score" value={String(extras.visionScore)} />
                <Stat label="Solo kills" value={String(extras.soloKills)} />
                <Stat label="First bloods" value={String(extras.firstBloods)} />
                <Stat label="Longest spree" value={String(extras.largestSpree)} />
                <Stat
                  label="Multikills"
                  value={`${extras.pentaKills}P · ${extras.quadraKills}Q · ${extras.tripleKills}T`}
                />
                <Stat label="Surrenders" value={String(extras.surrenders)} />
                <Stat
                  label="Mejor KDA en una partida"
                  value={extras.bestKdaGame ? extras.bestKdaGame.toFixed(2) : '—'}
                />
                <Stat
                  label="Usual hour (UTC)"
                  value={
                    extras.favouriteHour !== null
                      ? `${String(extras.favouriteHour).padStart(2, '0')}:00`
                      : '—'
                  }
                />
              </dl>
            </section>
          )}

          {(bestDay || worstDay) && (
            <section>
              <h3 className="eyebrow mb-2 text-ink-3">Best and worst day</h3>
              <div className="grid gap-2 sm:grid-cols-2">
                {bestDay && bestDay.delta > 0 && (
                  <DayCard day={bestDay.day} delta={bestDay.delta} good />
                )}
                {worstDay && worstDay.delta < 0 && (
                  <DayCard day={worstDay.day} delta={worstDay.delta} />
                )}
              </div>
            </section>
          )}

          {player.topChampions.length > 0 && (
            <section>
              <h3 className="eyebrow mb-2 text-ink-3">Most played</h3>
              <ul className="space-y-1.5">
                {player.topChampions.map((champion) => (
                  <li
                    key={champion.championId}
                    className="flex items-center gap-2.5 rounded-lg bg-carbon-2 p-2"
                  >
                    <img
                      src={championIconUrl(champion.championName)}
                      alt=""
                      width={28}
                      height={28}
                      className="h-7 w-7 rounded-md ring-1 ring-line"
                    />
                    <span className="flex-1 truncate text-fluid-sm">
                      {champion.championName}
                    </span>
                    <span className="tabular text-fluid-xs text-ink-2">
                      {champion.games} games
                    </span>
                    <span className="tabular text-fluid-xs font-medium">
                      {formatPercent(champion.wins / Math.max(champion.games, 1))}
                    </span>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {rivals.some((row) => row.together > 0) && (
            <section>
              <h3 className="eyebrow mb-2 text-ink-3">Duos</h3>
              <ul className="space-y-1.5">
                {rivals
                  .filter((row) => row.together > 0)
                  .sort(
                    (a, b) =>
                      b.togetherWins / b.together - a.togetherWins / a.together,
                  )
                  .map((duo) => {
                    const rate = duo.togetherWins / duo.together;
                    return (
                      <li
                        key={`duo-${duo.other!.id}`}
                        className="flex items-center gap-2 rounded-lg bg-carbon-2 p-2"
                      >
                        <Avatar
                          name={duo.other!.displayName}
                          iconId={duo.other!.profileIconId}
                          size={24}
                          ring={tierColor(duo.other!.rank)}
                        />
                        <span className="min-w-0 flex-1 truncate text-fluid-sm">
                          {duo.other!.displayName}
                        </span>
                        <span className="tabular text-fluid-xs text-ink-2">
                          {duo.together} together
                        </span>
                        <span
                          className="tabular text-fluid-xs font-semibold"
                          style={{
                            color:
                              rate >= 0.5
                                ? 'var(--color-mark-teal)'
                                : 'var(--color-mark-red)',
                          }}
                        >
                          {duo.togetherWins}–{duo.together - duo.togetherWins}
                        </span>
                      </li>
                    );
                  })}
              </ul>
            </section>
          )}

          {rivals.some((row) => row.against > 0) && (
            <section>
              <h3 className="eyebrow mb-2 text-ink-3">Faced in game</h3>
              <ul className="space-y-1.5">
                {rivals
                  .filter((row) => row.against > 0)
                  .map((rival) => (
                    <li
                      key={`vs-${rival.other!.id}`}
                      className="flex items-center gap-2 rounded-lg bg-carbon-2 p-2"
                    >
                      <Avatar
                        name={rival.other!.displayName}
                        iconId={rival.other!.profileIconId}
                        size={24}
                        ring={tierColor(rival.other!.rank)}
                      />
                      <span className="min-w-0 flex-1 truncate text-fluid-sm">
                        {rival.other!.displayName}
                      </span>
                      <span className="tabular text-fluid-xs text-ink-2">
                        {rival.against} faced
                      </span>
                      <span
                        className="tabular text-fluid-xs font-semibold"
                        style={{
                          color:
                            rival.wins * 2 >= rival.against
                              ? 'var(--color-mark-teal)'
                              : 'var(--color-mark-red)',
                        }}
                      >
                        {rival.wins}–{rival.against - rival.wins}
                      </span>
                    </li>
                  ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg border border-line bg-carbon-2 p-2.5">
      <dt className="text-[0.68rem] text-ink-3">{label}</dt>
      <dd className="tabular mt-1 text-fluid-sm font-medium">{value}</dd>
    </div>
  );
}

function DayCard({
  day,
  delta,
  good,
}: {
  day: string;
  delta: number;
  good?: boolean;
}) {
  const color = good ? 'var(--color-mark-teal)' : 'var(--color-mark-red)';
  return (
    <div className="rounded-lg border border-line bg-carbon-2 p-3">
      <p className="text-[0.68rem] text-ink-3">
        {good ? 'Mayor subida' : 'Peor tilt'}
      </p>
      <p className="tabular mt-1 text-fluid-lg font-semibold" style={{ color }}>
        {formatSigned(delta)} LP
      </p>
      <p className="text-fluid-xs text-ink-3">{day}</p>
    </div>
  );
}
