import type { RankedPlayer } from '../lib/domain/types';
import { titleCase } from '../lib/domain/ranking';
import {
  Avatar,
  FormSparkline,
  OpggLink,
  PositionDelta,
  ROLE_LABEL,
  StreakPill,
  championIconUrl,
  formatPercent,
  formatSigned,
  tierColor,
} from './ui';
import { RoleIcon, TierCrest } from './icons';

export function RankingTable({ players }: { players: RankedPlayer[] }) {
  if (players.length === 0) {
    return (
      <div className="rounded-2xl border border-line bg-carbon p-10 text-center">
        <p className="display text-fluid-lg">No players match these filters</p>
        <p className="mt-1 text-fluid-sm text-ink-2">
          Clear the search or pick a different role.
        </p>
      </div>
    );
  }

  return (
    <>
      <div className="hidden overflow-x-auto md:block">
        <table className="w-full min-w-[980px] border-separate border-spacing-y-1.5 text-fluid-sm">
          <caption className="sr-only">
            Full standings, sorted with the controls above
          </caption>
          <thead>
            <tr className="eyebrow text-left text-ink-3">
              <th scope="col" className="w-20 px-4 pb-1 font-semibold">
                #
              </th>
              <th scope="col" className="px-2 pb-1 font-semibold">
                Player
              </th>
              <th scope="col" className="px-2 pb-1 font-semibold">
                Role
              </th>
              <th scope="col" className="px-2 pb-1 font-semibold">
                Elo
              </th>
              <th scope="col" className="px-2 pb-1 font-semibold">
                Win / Loss
              </th>
              <th scope="col" className="px-2 pb-1 font-semibold">
                Form
              </th>
              <th scope="col" className="px-2 pb-1 text-right font-semibold">
                LP
              </th>
              <th scope="col" className="px-2 pb-1 text-right font-semibold">
                KDA
              </th>
              <th scope="col" className="px-2 pb-1 font-semibold">
                Champions
              </th>
              <th scope="col" className="px-4 pb-1 font-semibold">
                <span className="sr-only">External profile</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {players.map((player) => {
              const accent = tierColor(player.rank);
              return (
                <tr
                  key={player.id}
                  className="group bg-carbon transition-colors hover:bg-carbon-2"
                  style={{ '--tier': accent } as React.CSSProperties}
                >
                  <td className="relative rounded-l-xl py-3 pr-2 pl-4">
                    {/* Tier-coloured rail: the row's identity, not decoration. */}
                    <span
                      aria-hidden="true"
                      className="absolute inset-y-1.5 left-0 w-[3px] rounded-full"
                      style={{
                        background: accent,
                        boxShadow: `0 0 10px -1px ${accent}`,
                      }}
                    />
                    <span className="flex items-baseline gap-1.5">
                      <span className="tabular text-fluid-base font-semibold">
                        {player.position}
                      </span>
                      <PositionDelta
                        position={player.position}
                        previousPosition={player.previousPosition}
                      />
                    </span>
                  </td>

                  <td className="px-2 py-3">
                    <div className="flex items-center gap-2.5">
                      <Avatar
                        name={player.displayName}
                        iconId={player.profileIconId}
                        size={34}
                        inGame={player.inGame}
                        ring={accent}
                      />
                      <div className="min-w-0">
                        <p className="display flex items-center gap-1.5 truncate text-fluid-sm">
                          {player.displayName}
                          {player.inGame && <LiveTag />}
                        </p>
                        <p className="truncate text-[0.68rem] text-ink-3">
                          {player.gameName}#{player.tagLine}
                          {player.error && ' · data unavailable'}
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-2 py-3">
                    <span
                      className="inline-flex items-center gap-1.5 text-ink-2"
                      title={ROLE_LABEL[player.role]}
                    >
                      <RoleIcon role={player.role} size={17} />
                      <span className="hidden lg:inline">
                        {ROLE_LABEL[player.role]}
                      </span>
                    </span>
                  </td>

                  <td className="px-2 py-3">
                    <div className="flex items-center gap-2">
                      <TierCrest rank={player.rank} size={24} />
                      <div className="leading-tight">
                        <p
                          className="text-[0.7rem] font-semibold"
                          style={{ color: accent }}
                        >
                          {player.rank
                            ? `${titleCase(player.rank.tier)}${
                                player.rank.division
                                  ? ` ${player.rank.division}`
                                  : ''
                              }`
                            : 'Unranked'}
                        </p>
                        <p className="tabular text-fluid-sm">
                          {player.rank?.leaguePoints ?? 0}
                          <span className="ml-1 text-[0.65rem] text-ink-3">
                            LP
                          </span>
                        </p>
                      </div>
                    </div>
                  </td>

                  <td className="px-2 py-3">
                    <SplitBar
                      wins={player.totals.wins}
                      losses={player.totals.losses}
                    />
                  </td>

                  <td className="px-2 py-3">
                    <div className="flex items-center gap-2">
                      <FormSparkline results={player.recentResults} />
                      <StreakPill streak={player.streak} />
                    </div>
                  </td>

                  <td className="px-2 py-3 text-right">
                    <LpDelta value={player.ladderPointsGained} />
                  </td>

                  <td className="tabular px-2 py-3 text-right">
                    {player.kda.toFixed(2)}
                  </td>

                  <td className="px-2 py-3">
                    <ChampionStrip player={player} />
                  </td>

                  <td className="rounded-r-xl px-4 py-3 text-right">
                    <OpggLink url={player.opggUrl} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Narrow screens: cards, so nothing hides behind a horizontal scrollbar. */}
      <ul className="space-y-2 md:hidden">
        {players.map((player) => {
          const accent = tierColor(player.rank);
          return (
            <li
              key={player.id}
              className="relative overflow-hidden rounded-xl border border-line bg-carbon p-3 pl-4"
              style={{ '--tier': accent } as React.CSSProperties}
            >
              <span
                aria-hidden="true"
                className="absolute inset-y-0 left-0 w-[3px]"
                style={{ background: accent }}
              />
              <div className="flex items-center gap-2.5">
                <span className="tabular w-9 shrink-0">
                  <span className="text-fluid-base font-semibold">
                    {player.position}
                  </span>
                </span>
                <Avatar
                  name={player.displayName}
                  iconId={player.profileIconId}
                  size={36}
                  inGame={player.inGame}
                  ring={accent}
                />
                <div className="min-w-0 flex-1">
                  <p className="display flex items-center gap-1.5 truncate text-fluid-sm">
                    {player.displayName}
                    {player.inGame && <LiveTag />}
                  </p>
                  <p className="flex items-center gap-1 truncate text-[0.68rem] text-ink-3">
                    <RoleIcon role={player.role} size={12} />
                    {ROLE_LABEL[player.role]} · {player.gameName}#
                    {player.tagLine}
                  </p>
                </div>
                <PositionDelta
                  position={player.position}
                  previousPosition={player.previousPosition}
                />
              </div>

              <div className="mt-3 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2">
                  <TierCrest rank={player.rank} size={22} />
                  <span className="tabular text-fluid-sm">
                    {player.rank?.leaguePoints ?? 0}
                    <span className="ml-1 text-[0.65rem] text-ink-3">LP</span>
                  </span>
                </div>
                <LpDelta value={player.ladderPointsGained} />
              </div>

              <div className="mt-3 border-t border-line pt-2">
                <SplitBar
                  wins={player.totals.wins}
                  losses={player.totals.losses}
                />
              </div>

              <div className="mt-2 flex items-center justify-between gap-2">
                <FormSparkline results={player.recentResults} width={90} />
                <span className="tabular text-fluid-xs text-ink-2">
                  KDA {player.kda.toFixed(2)}
                </span>
                <OpggLink url={player.opggUrl} />
              </div>
            </li>
          );
        })}
      </ul>
    </>
  );
}

function LiveTag() {
  return (
    <span
      className="eyebrow shrink-0 rounded px-1 py-px text-[0.55rem]"
      style={{
        color: 'var(--color-mark-teal)',
        background: 'color-mix(in oklab, var(--color-mark-teal) 16%, transparent)',
      }}
    >
      Live
    </span>
  );
}

/**
 * Wins and losses as one rail with a 2px gap between the fills, plus both raw
 * counts and the percentage in text — the colours are a shortcut, not the data.
 */
function SplitBar({ wins, losses }: { wins: number; losses: number }) {
  const total = wins + losses;
  const ratio = total === 0 ? 0 : wins / total;

  return (
    <div className="min-w-[140px]">
      <div className="tabular mb-1 flex items-baseline gap-2 text-[0.7rem]">
        <span className="font-semibold">
          {total === 0 ? '—' : formatPercent(ratio)}
        </span>
        <span style={{ color: 'var(--color-mark-teal)' }}>{wins}W</span>
        <span style={{ color: 'var(--color-mark-red)' }}>{losses}L</span>
      </div>
      <div
        className="flex h-1.5 gap-[2px] overflow-hidden rounded-full bg-carbon-3"
        role="img"
        aria-label={`${wins} wins, ${losses} losses`}
      >
        <span
          className="rounded-full"
          style={{
            width: `${ratio * 100}%`,
            background: 'var(--color-mark-teal)',
            boxShadow: '0 0 10px -2px var(--color-mark-teal)',
          }}
        />
        <span
          className="flex-1 rounded-full"
          style={{ background: 'var(--color-mark-red)', opacity: 0.55 }}
        />
      </div>
    </div>
  );
}

function LpDelta({ value }: { value: number }) {
  if (value === 0) {
    return <span className="tabular text-ink-3">±0</span>;
  }
  const color =
    value > 0 ? 'var(--color-mark-teal)' : 'var(--color-mark-red)';

  return (
    <span
      className="tabular font-semibold"
      style={{ color, textShadow: `0 0 12px color-mix(in oklab, ${color} 45%, transparent)` }}
    >
      {formatSigned(value)}
    </span>
  );
}

function ChampionStrip({ player }: { player: RankedPlayer }) {
  if (player.topChampions.length === 0) {
    return <span className="text-ink-3">—</span>;
  }

  return (
    <div className="flex items-center gap-1">
      {player.topChampions.map((champion) => (
        <img
          key={champion.championId}
          src={championIconUrl(champion.championName)}
          alt={champion.championName}
          title={`${champion.championName} · ${champion.games} games, ${
            champion.games > 0
              ? formatPercent(champion.wins / champion.games)
              : '—'
          } win rate`}
          width={26}
          height={26}
          loading="lazy"
          className="h-[26px] w-[26px] rounded-md bg-carbon-3 ring-1 ring-line"
        />
      ))}
    </div>
  );
}
