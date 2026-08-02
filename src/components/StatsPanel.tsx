import type { RankedPlayer } from '../lib/domain/types';
import { Avatar, classNames, formatPercent, tierColor } from './ui';

interface LeaderRow {
  player: RankedPlayer;
  value: number;
  display: string;
}

interface Category {
  key: string;
  title: string;
  caption: string;
  pick: (player: RankedPlayer) => number;
  format: (value: number) => string;
  minimumGames: number;
}

const CATEGORIES: Category[] = [
  {
    key: 'kills',
    title: 'Kills',
    caption: 'Most eliminations',
    pick: (player) => player.totals.kills,
    format: (value) => value.toLocaleString(),
    minimumGames: 1,
  },
  {
    key: 'deaths',
    title: 'Deaths',
    caption: 'Most times eliminated',
    pick: (player) => player.totals.deaths,
    format: (value) => value.toLocaleString(),
    minimumGames: 1,
  },
  {
    key: 'assists',
    title: 'Assists',
    caption: 'Most assists',
    pick: (player) => player.totals.assists,
    format: (value) => value.toLocaleString(),
    minimumGames: 1,
  },
  {
    key: 'cspm',
    title: 'CS / min',
    caption: 'Farm per minute',
    pick: (player) => player.csPerMinute,
    format: (value) => value.toFixed(2),
    minimumGames: 5,
  },
];

/**
 * Aggregate totals set the scale of the challenge, then one ranked column per
 * measure. Each column leads with its winner at display size because that is
 * the thing people actually come to look up.
 */
export function StatsPanel({ players }: { players: RankedPlayer[] }) {
  const totals = players.reduce(
    (accumulator, player) => ({
      games: accumulator.games + player.totals.games,
      kills: accumulator.kills + player.totals.kills,
      deaths: accumulator.deaths + player.totals.deaths,
      assists: accumulator.assists + player.totals.assists,
      minutes: accumulator.minutes + player.totals.minutesPlayed,
      wins: accumulator.wins + player.totals.wins,
    }),
    { games: 0, kills: 0, deaths: 0, assists: 0, minutes: 0, wins: 0 },
  );

  const pooledKda = (totals.kills + totals.assists) / Math.max(totals.deaths, 1);

  const rank = (category: Category): LeaderRow[] =>
    players
      .filter((player) => player.totals.games >= category.minimumGames)
      .map((player) => {
        const value = category.pick(player);
        return { player, value, display: category.format(value) };
      })
      .sort((a, b) => b.value - a.value)
      .slice(0, 5);

  const kdaLeaders = players
    .filter((player) => player.totals.games >= 5)
    .map((player) => ({
      player,
      value: player.kda,
      display: player.kda.toFixed(2),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, 4);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Games" value={totals.games.toLocaleString()} />
        <Tile
          label="Hours played"
          value={Math.round(totals.minutes / 60).toLocaleString()}
        />
        <Tile
          label="Combined win rate"
          value={
            totals.games > 0 ? formatPercent(totals.wins / totals.games, 1) : '—'
          }
        />
        <Tile label="Kills" value={totals.kills.toLocaleString()} />
        <Tile label="Deaths" value={totals.deaths.toLocaleString()} />
        <Tile label="Pooled KDA" value={pooledKda.toFixed(2)} />
      </dl>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {CATEGORIES.map((category) => (
          <LeaderColumn
            key={category.key}
            title={category.title}
            caption={category.caption}
            rows={rank(category)}
          />
        ))}
      </div>

      <section className="rounded-2xl border border-line bg-carbon p-4">
        <header className="text-center">
          <h3 className="display text-fluid-lg">KDA</h3>
          <p className="eyebrow mt-1 text-ink-3">
            Kills + assists ÷ deaths · 5 games minimum
          </p>
        </header>

        {kdaLeaders.length === 0 ? (
          <p className="mt-4 text-center text-fluid-sm text-ink-3">
            No player has reached 5 games yet.
          </p>
        ) : (
          <ol className="mt-5 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            {kdaLeaders.map((row, index) => (
              <li
                key={row.player.id}
                className="flex items-center justify-center gap-3"
              >
                <span className="tabular text-fluid-sm text-ink-3">
                  {index + 1}
                </span>
                <Avatar
                  name={row.player.displayName}
                  iconId={row.player.profileIconId}
                  size={46}
                  ring={tierColor(row.player.rank)}
                />
                <div>
                  <p
                    className="tabular text-[2rem] leading-none font-semibold"
                    style={{
                      color: 'var(--color-ink)',
                      textShadow: '0 0 24px rgb(255 255 255 / 25%)',
                    }}
                  >
                    {row.display}
                  </p>
                  <p className="mt-1 truncate text-fluid-xs text-ink-2">
                    {row.player.displayName}
                  </p>
                  <p className="text-[0.68rem] text-ink-3">
                    {row.player.totals.games} games
                  </p>
                </div>
              </li>
            ))}
          </ol>
        )}
      </section>
    </div>
  );
}

function Tile({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl border border-line bg-carbon p-3">
      <dt className="eyebrow text-ink-3">{label}</dt>
      <dd className="tabular mt-1.5 text-fluid-lg leading-none font-semibold">
        {value}
      </dd>
    </div>
  );
}

function LeaderColumn({
  title,
  caption,
  rows,
}: {
  title: string;
  caption: string;
  rows: LeaderRow[];
}) {
  const [winner, ...rest] = rows;

  return (
    <section className="rounded-2xl border border-line bg-carbon p-4">
      <header className="text-center">
        <h3 className="display text-fluid-lg">{title}</h3>
        <p className="eyebrow mt-1 text-ink-3">{caption}</p>
      </header>

      {!winner ? (
        <p className="mt-6 text-center text-fluid-sm text-ink-3">
          Not enough games yet.
        </p>
      ) : (
        <>
          <div className="mt-5 flex items-center justify-center gap-3">
            <span className="tabular text-fluid-sm text-ink-3">1</span>
            <Avatar
              name={winner.player.displayName}
              iconId={winner.player.profileIconId}
              size={52}
              ring={tierColor(winner.player.rank)}
            />
            <div className="min-w-0">
              <p
                className="tabular text-[2.1rem] leading-none font-semibold"
                style={{
                  color: 'var(--color-ink)',
                  textShadow: '0 0 24px rgb(255 255 255 / 25%)',
                }}
              >
                {winner.display}
              </p>
              <p className="mt-1 truncate text-fluid-xs text-ink-2">
                {winner.player.displayName}
              </p>
              <p className="text-[0.68rem] text-ink-3">
                {winner.player.totals.games} games
              </p>
            </div>
          </div>

          <ol className="mt-4 space-y-1.5">
            {rest.map((row, index) => {
              const accent = tierColor(row.player.rank);
              return (
                <li
                  key={row.player.id}
                  className="relative flex items-center gap-2 overflow-hidden rounded-lg bg-carbon-2 py-1.5 pr-2 pl-3"
                >
                  <span
                    aria-hidden="true"
                    className="absolute inset-y-0 left-0 w-[2px]"
                    style={{ background: accent }}
                  />
                  <span className="tabular w-3 text-[0.7rem] text-ink-3">
                    {index + 2}
                  </span>
                  <Avatar
                    name={row.player.displayName}
                    iconId={row.player.profileIconId}
                    size={22}
                  />
                  <span
                    className={classNames(
                      'min-w-0 flex-1 truncate text-fluid-xs',
                    )}
                  >
                    {row.player.displayName}
                  </span>
                  <span className="tabular text-fluid-xs font-semibold">
                    {row.display}
                  </span>
                  <span className="tabular hidden text-[0.65rem] whitespace-nowrap text-ink-3 sm:inline">
                    {row.player.totals.games}g
                  </span>
                </li>
              );
            })}
          </ol>
        </>
      )}
    </section>
  );
}
