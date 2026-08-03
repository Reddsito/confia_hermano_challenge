import type { RankedPlayer, Snapshot } from '@challenge/core/domain';
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

/** How deep each board goes. One winner plus the chasing pack. */
const TOP_N = 10;

const CATEGORIES: Category[] = [
  {
    key: 'kills',
    title: 'Asesinatos',
    caption: 'Más eliminaciones',
    pick: (player) => player.totals.kills,
    format: (value) => value.toLocaleString(),
    minimumGames: 1,
  },
  {
    key: 'deaths',
    title: 'Muertes',
    caption: 'Más veces eliminado',
    pick: (player) => player.totals.deaths,
    format: (value) => value.toLocaleString(),
    minimumGames: 1,
  },
  {
    key: 'assists',
    title: 'Asistencias',
    caption: 'Más asistencias',
    pick: (player) => player.totals.assists,
    format: (value) => value.toLocaleString(),
    minimumGames: 1,
  },
  {
    key: 'cspm',
    title: 'CS / min',
    caption: 'Farmeo por minuto',
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
export function StatsPanel({
  players,
  duos,
}: {
  players: RankedPlayer[];
  duos: Snapshot['duos'];
}) {
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
      .slice(0, TOP_N);

  const kdaLeaders = players
    .filter((player) => player.totals.games >= 5)
    .map((player) => ({
      player,
      value: player.kda,
      display: player.kda.toFixed(2),
    }))
    .sort((a, b) => b.value - a.value)
    .slice(0, TOP_N);

  return (
    <div className="space-y-4">
      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 xl:grid-cols-6">
        <Tile label="Partidas" value={totals.games.toLocaleString()} />
        <Tile
          label="Horas jugadas"
          value={Math.round(totals.minutes / 60).toLocaleString()}
        />
        <Tile
          label="Winrate combinado"
          value={
            totals.games > 0 ? formatPercent(totals.wins / totals.games, 1) : '—'
          }
        />
        <Tile label="Asesinatos" value={totals.kills.toLocaleString()} />
        <Tile label="Muertes" value={totals.deaths.toLocaleString()} />
        <Tile label="KDA global" value={pooledKda.toFixed(2)} />
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

      <DuoBoard duos={duos} players={players} />

      <section className="rounded-2xl border border-line bg-carbon p-4">
        <header className="text-center">
          <h3 className="display text-fluid-lg">KDA</h3>
          <p className="eyebrow mt-1 text-ink-3">
            Kills + assists ÷ deaths · 5 games minimum
          </p>
        </header>

        {kdaLeaders.length === 0 ? (
          <p className="mt-4 text-center text-fluid-sm text-ink-3">
            Ningún jugador llegó a 5 partidas todavía.
          </p>
        ) : (
          <>
            <Winner row={kdaLeaders[0]!} />
            {kdaLeaders.length > 1 && (
              <ol className="mt-4 grid gap-1.5 sm:grid-cols-2">
                {kdaLeaders.slice(1).map((row, index) => (
                  <ChaserRow key={row.player.id} row={row} position={index + 2} />
                ))}
              </ol>
            )}
          </>
        )}
      </section>
    </div>
  );
}

/** Pairs who queue together, ranked by how often it works out. */
function DuoBoard({
  duos,
  players,
}: {
  duos: Snapshot['duos'];
  players: RankedPlayer[];
}) {
  const byId = new Map(players.map((player) => [player.id, player]));

  const rows = duos
    .map((duo) => ({
      a: byId.get(duo.playerA),
      b: byId.get(duo.playerB),
      games: duo.games,
      wins: duo.wins,
    }))
    .filter((row) => row.a && row.b)
    .slice(0, TOP_N);

  return (
    <section className="rounded-2xl border border-line bg-carbon p-4">
      <header className="text-center">
        <h3 className="display text-fluid-lg">Best duos</h3>
        <p className="eyebrow mt-1 text-ink-3">
          Games queued together · 2 game minimum
        </p>
      </header>

      {rows.length === 0 ? (
        <p className="mt-4 text-center text-fluid-sm text-ink-3">
          Todavía nadie hizo dúo, o no jugaron suficientes partidas juntos.
        </p>
      ) : (
        <ol className="mt-4 grid gap-1.5 sm:grid-cols-2">
          {rows.map((row, index) => {
            const rate = row.wins / row.games;
            return (
              <li
                key={`${row.a!.id}-${row.b!.id}`}
                className="relative flex items-center gap-2 overflow-hidden rounded-lg bg-carbon-2 py-1.5 pr-2 pl-3"
              >
                <span
                  aria-hidden="true"
                  className="absolute inset-y-0 left-0 w-[2px]"
                  style={{
                    background:
                      rate >= 0.5
                        ? 'var(--color-mark-teal)'
                        : 'var(--color-mark-red)',
                  }}
                />
                <span className="tabular w-4 text-[0.7rem] text-ink-3">
                  {index + 1}
                </span>
                <Avatar name={row.a!.displayName} iconId={row.a!.profileIconId} size={20} />
                <Avatar name={row.b!.displayName} iconId={row.b!.profileIconId} size={20} />
                <span className="min-w-0 flex-1 truncate text-fluid-xs">
                  {row.a!.displayName} + {row.b!.displayName}
                </span>
                <span className="tabular text-fluid-xs font-semibold">
                  {formatPercent(rate)}
                </span>
                <span className="tabular text-[0.65rem] whitespace-nowrap text-ink-3">
                  {row.wins}-{row.games - row.wins}
                </span>
              </li>
            );
          })}
        </ol>
      )}
    </section>
  );
}

function Winner({ row }: { row: LeaderRow }) {
  return (
    <div className="mt-5 flex items-center justify-center gap-3">
      <span className="tabular text-fluid-sm text-ink-3">1</span>
      <Avatar
        name={row.player.displayName}
        iconId={row.player.profileIconId}
        size={52}
        ring={tierColor(row.player.rank)}
      />
      <div className="min-w-0">
        <p
          className="tabular text-[2.1rem] leading-none font-semibold"
          style={{ color: 'var(--color-ink)', textShadow: '0 0 24px rgb(255 255 255 / 25%)' }}
        >
          {row.display}
        </p>
        <p className="mt-1 truncate text-fluid-xs text-ink-2">
          {row.player.displayName}
        </p>
        <p className="text-[0.68rem] text-ink-3">{row.player.totals.games} games</p>
      </div>
    </div>
  );
}

function ChaserRow({ row, position }: { row: LeaderRow; position: number }) {
  const accent = tierColor(row.player.rank);

  return (
    <li className="relative flex items-center gap-2 overflow-hidden rounded-lg bg-carbon-2 py-1.5 pr-2 pl-3">
      <span
        aria-hidden="true"
        className="absolute inset-y-0 left-0 w-[2px]"
        style={{ background: accent }}
      />
      <span className="tabular w-4 text-[0.7rem] text-ink-3">{position}</span>
      <Avatar
        name={row.player.displayName}
        iconId={row.player.profileIconId}
        size={22}
      />
      <span className="min-w-0 flex-1 truncate text-fluid-xs">
        {row.player.displayName}
      </span>
      <span className="tabular text-fluid-xs font-semibold">{row.display}</span>
      <span className="tabular hidden text-[0.65rem] whitespace-nowrap text-ink-3 sm:inline">
        {row.player.totals.games}g
      </span>
    </li>
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
          Todavía no hay suficientes partidas.
        </p>
      ) : (
        <>
          <Winner row={winner} />
          <ol className="mt-4 space-y-1.5">
            {rest.map((row, index) => (
              <ChaserRow key={row.player.id} row={row} position={index + 2} />
            ))}
          </ol>
        </>
      )}
    </section>
  );
}
