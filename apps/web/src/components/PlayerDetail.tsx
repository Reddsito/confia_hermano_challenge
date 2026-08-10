import { useEffect, useRef, useState } from 'react';

import {
  MAX_HELD_SHELLS,
  titleCase,
  type RankedPlayer,
  type Snapshot,
} from '@challenge/core/domain';

import {
  fetchPlayerDetail,
  type MatchRecord,
  type PlayerDetailData,
  type ThrowRecord,
} from '../lib/players';
import { oneOf } from '../lib/route';
import { RoleIcon, TierCrest } from './icons';
import { Tabs, type TabDefinition } from './Tabs';
import {
  Avatar,
  FormSparkline,
  OpggLink,
  ROLE_LABEL,
  StreakPill,
  championIconUrl,
  classNames,
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

/** "28:42" from a duration the sync stored as fractional minutes. */
function formatClock(minutes: number): string {
  const total = Math.round(minutes * 60);
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/**
 * Coarse on purpose. A match list is scanned, not read: "hace 9 h" answers the
 * only question being asked of it, and a precise timestamp would be more
 * characters saying less.
 */
function formatAgo(timestamp: number): string {
  const minutes = Math.round((Date.now() - timestamp) / 60_000);
  if (minutes < 1) return 'recién';
  if (minutes < 60) return `hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `hace ${hours} h`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'ayer' : `hace ${days} días`;
}

/** "06 ago 17:32" — short enough to sit on the same line as the challenge. */
function formatStamp(timestamp: number): string {
  return new Date(timestamp).toLocaleString('es', {
    day: '2-digit',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  });
}

/** A perfect game has no denominator, so it is reported rather than divided. */
function formatKda(kills: number, deaths: number, assists: number): string {
  if (deaths === 0) return 'Perfecto';
  return ((kills + assists) / deaths).toFixed(2);
}

type TabId = 'historial' | 'stats' | 'shells';

const TABS: ReadonlyArray<TabDefinition<TabId>> = [
  { id: 'historial', label: 'Historial' },
  { id: 'stats', label: 'Stats & Elo' },
  { id: 'shells', label: 'Blue Shell' },
];

interface PlayerDetailProps {
  player: RankedPlayer;
  snapshot: Snapshot;
  allPlayers: RankedPlayer[];
  /** Raw tab id from the URL; anything unknown falls back to the history. */
  tab: string | null;
  onTabChange: (tab: TabId) => void;
  onClose: () => void;
}

/**
 * A modal dialog rather than a page, but still addressable: the standings stay
 * in place behind it, so closing returns you exactly where you were in a long
 * table, while the open card lives in the URL so a refresh or a shared link
 * reopens it.
 *
 * The three tabs are fed by one request made when the modal opens. Splitting
 * them into a fetch per tab would trade a single wait for a stutter on every
 * click, and the whole payload is one player's history — small enough that
 * paying for it once is the cheaper deal.
 */
export function PlayerDetail({
  player,
  snapshot,
  allPlayers,
  tab: requestedTab,
  onTabChange,
  onClose,
}: PlayerDetailProps) {
  const closeRef = useRef<HTMLButtonElement>(null);
  const accent = tierColor(player.rank);
  const extras = player.extras;

  const tab = oneOf(
    requestedTab,
    TABS.map((entry) => entry.id),
    'historial',
  );
  const [detail, setDetail] = useState<PlayerDetailData | null>(null);
  const [failed, setFailed] = useState(false);

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

  useEffect(() => {
    // Aborted on unmount so closing the modal mid-flight cannot land a setState
    // on a component that is gone, and so a fast open-close-open does not race
    // the first response against the second.
    const controller = new AbortController();

    setDetail(null);
    setFailed(false);

    fetchPlayerDetail(player.id, controller.signal)
      .then(setDetail)
      .catch((error: unknown) => {
        if (error instanceof DOMException && error.name === 'AbortError') return;
        setFailed(true);
      });

    return () => controller.abort();
  }, [player.id]);

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
        aria-label={`Ficha de ${player.displayName}`}
        onClick={(event) => event.stopPropagation()}
        className="max-h-[92dvh] w-full max-w-5xl overflow-y-auto rounded-t-2xl border border-line bg-carbon sm:rounded-2xl"
        style={{ '--tier': accent } as React.CSSProperties}
      >
        <header
          className="sticky top-0 z-10 border-b border-line bg-carbon/95 p-4 backdrop-blur"
          style={{ boxShadow: `inset 0 2px 0 0 ${accent}` }}
        >
          <div className="flex items-start gap-3">
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
              Cerrar
            </button>
          </div>

          <div className="mt-3">
            <Tabs
              tabs={TABS}
              active={tab}
              onChange={onTabChange}
              label="Secciones de la ficha"
              size="sm"
            />
          </div>
        </header>

        <div className="space-y-5 p-4">
          {tab === 'historial' && (
            <HistoryTab matches={detail?.matches ?? null} failed={failed} />
          )}

          {tab === 'shells' && (
            <ShellsTab shells={detail?.shells ?? null} failed={failed} />
          )}

          {tab === 'stats' && (
            <>
              <section className="flex flex-wrap items-center gap-4">
                <TierCrest rank={player.rank} size={44} />
                <div>
                  <p className="eyebrow" style={{ color: accent }}>
                    {player.rank
                      ? `${titleCase(player.rank.tier)}${player.rank.division ? ` ${player.rank.division}` : ''}`
                      : 'Sin clasificar'}
                  </p>
                  <p className="tabular text-[2rem] leading-none font-semibold">
                    {player.rank?.leaguePoints ?? 0}
                    <span className="eyebrow ml-1.5 text-ink-3">LP</span>
                  </p>
                </div>
                <div className="ml-auto flex items-center gap-3">
                  <FormSparkline
                    results={player.recentResults}
                    width={110}
                    height={34}
                  />
                  <StreakPill streak={player.streak} />
                  <OpggLink url={player.opggUrl} />
                </div>
              </section>

              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                <Stat
                  label="Récord"
                  value={`${player.totals.wins}V ${player.totals.losses}D`}
                />
                <Stat label="Winrate" value={formatPercent(player.winRate, 1)} />
                <Stat label="KDA" value={player.kda.toFixed(2)} />
                <Stat
                  label="LP ganados"
                  value={formatSigned(player.ladderPointsGained)}
                />
                <Stat
                  label="K / D / A"
                  value={`${player.totals.kills} / ${player.totals.deaths} / ${player.totals.assists}`}
                />
                <Stat label="CS por min" value={player.csPerMinute.toFixed(1)} />
                <Stat
                  label="Horas jugadas"
                  value={(player.totals.minutesPlayed / 60).toFixed(1)}
                />
                <Stat
                  label="Participación en asesinatos"
                  value={
                    extras?.killParticipation !== null &&
                    extras?.killParticipation !== undefined
                      ? formatPercent(extras.killParticipation)
                      : '—'
                  }
                />
              </dl>

              {extras && (
                <section>
                  <h3 className="eyebrow mb-2 text-ink-3">Los detalles</h3>
                  <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    <Stat
                      label="Tiempo muerto"
                      value={formatDuration(extras.timeDeadSeconds)}
                    />
                    <Stat
                      label="Daño infligido"
                      value={formatCompact(extras.damageToChampions)}
                    />
                    <Stat
                      label="Daño recibido"
                      value={formatCompact(extras.damageTaken)}
                    />
                    <Stat
                      label="Oro ganado"
                      value={formatCompact(extras.goldEarned)}
                    />
                    <Stat
                      label="Puntaje de visión"
                      value={String(extras.visionScore)}
                    />
                    <Stat
                      label="Asesinatos en solitario"
                      value={String(extras.soloKills)}
                    />
                    <Stat
                      label="Primera sangre"
                      value={String(extras.firstBloods)}
                    />
                    <Stat
                      label="Mayor racha de asesinatos"
                      value={String(extras.largestSpree)}
                    />
                    <Stat
                      label="Multikills"
                      value={`${extras.pentaKills}P · ${extras.quadraKills}Q · ${extras.tripleKills}T`}
                    />
                    <Stat
                      label="Rendiciones"
                      value={String(extras.surrenders)}
                    />
                    <Stat
                      label="Mejor KDA en una partida"
                      value={
                        extras.bestKdaGame ? extras.bestKdaGame.toFixed(2) : '—'
                      }
                    />
                    <Stat
                      label="Hora habitual (UTC)"
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
                  <h3 className="eyebrow mb-2 text-ink-3">Mejor y peor día</h3>
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
                  <h3 className="eyebrow mb-2 text-ink-3">Más jugados</h3>
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
                          {champion.games} partidas
                        </span>
                        <span className="tabular text-fluid-xs font-medium">
                          {formatPercent(
                            champion.wins / Math.max(champion.games, 1),
                          )}
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
                          b.togetherWins / b.together -
                          a.togetherWins / a.together,
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
                              {duo.together} juntos
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
                              {duo.togetherWins}–
                              {duo.together - duo.togetherWins}
                            </span>
                          </li>
                        );
                      })}
                  </ul>
                </section>
              )}

              {rivals.some((row) => row.against > 0) && (
                <section>
                  <h3 className="eyebrow mb-2 text-ink-3">Enfrentados</h3>
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
                            {rival.against} veces
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
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/** One message for both waiting and failing, since neither has content to show. */
function Placeholder({ failed }: { failed: boolean }) {
  return (
    <p className="py-8 text-center text-fluid-xs text-ink-3">
      {failed ? 'No pudimos traer estos datos.' : 'Cargando…'}
    </p>
  );
}

function HistoryTab({
  matches,
  failed,
}: {
  matches: MatchRecord[] | null;
  failed: boolean;
}) {
  if (!matches) return <Placeholder failed={failed} />;
  if (matches.length === 0) {
    return (
      <p className="py-8 text-center text-fluid-xs text-ink-3">
        Todavía no hay partidas registradas.
      </p>
    );
  }

  return (
    <ul className="space-y-1.5">
      {matches.map((match) => {
        const color = match.win
          ? 'var(--color-mark-teal)'
          : 'var(--color-mark-red)';

        return (
          <li
            key={match.matchId}
            className="flex items-center gap-3 rounded-lg bg-carbon-2 p-2.5"
            style={{ boxShadow: `inset 3px 0 0 0 ${color}` }}
          >
            <img
              src={championIconUrl(match.championName)}
              alt={match.championName}
              width={34}
              height={34}
              className="h-[34px] w-[34px] shrink-0 rounded-md ring-1 ring-line"
            />

            <div className="min-w-0 flex-1">
              <p className="text-fluid-sm font-semibold" style={{ color }}>
                {match.win ? 'Victoria' : 'Derrota'}
                {match.lpDelta !== null && (
                  <span className="tabular ml-2">
                    {formatSigned(match.lpDelta)} LP
                  </span>
                )}
                <span className="tabular ml-2 font-normal text-ink-3">
                  {formatClock(match.durationMinutes)} · {formatAgo(match.playedAt)}
                </span>
              </p>
              <p className="tabular truncate text-fluid-xs text-ink-2">
                {match.kills} / <span className="text-mark-red">{match.deaths}</span>{' '}
                / {match.assists}
                <span className="ml-2 text-ink-3">
                  {formatKda(match.kills, match.deaths, match.assists)} KDA
                </span>
                {match.killParticipation !== null && (
                  <span className="ml-2 text-ink-3">
                    {formatPercent(match.killParticipation)} PA
                  </span>
                )}
                <span className="ml-2 text-ink-3">{match.creepScore} CS</span>
              </p>
            </div>

            <div className="flex shrink-0 flex-col items-end gap-1">
              {match.pentaKills > 0 && <Badge label="Pentakill" strong />}
              {match.pentaKills === 0 && match.quadraKills > 0 && (
                <Badge label="Cuádruple" strong />
              )}
              {match.firstBlood && <Badge label="Primera sangre" />}
              {match.surrendered && <Badge label="Rendición" />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

function Badge({ label, strong }: { label: string; strong?: boolean }) {
  return (
    <span
      className={classNames(
        'eyebrow rounded-full border px-2 py-0.5 text-[0.6rem]',
        strong ? 'border-transparent text-void' : 'border-line text-ink-3',
      )}
      style={strong ? { background: 'var(--color-accent)' } : undefined}
    >
      {label}
    </span>
  );
}

/**
 * Rows per page. Chosen so a full page of one column is about as tall as the
 * summary strip plus the other column's header — the panel keeps one height
 * whichever page you are on, instead of the list growing and shrinking under
 * the cursor.
 */
const SHELL_PAGE_SIZE = 10;

function ShellsTab({
  shells,
  failed,
}: {
  shells: PlayerDetailData['shells'] | null;
  failed: boolean;
}) {
  if (!shells) return <Placeholder failed={failed} />;

  const { balance, thrown, received } = shells;
  const owed = received.filter((record) => !record.completedAt).length;

  return (
    <div className="space-y-4">
      {/*
        One strip rather than four cards: these are four numbers, and a card
        each spent most of its area on padding.
      */}
      <div className="flex flex-wrap items-stretch gap-px overflow-hidden rounded-xl border border-line bg-line">
        <Tally
          label="En inventario"
          value={`${balance.available}`}
          suffix={`/ ${MAX_HELD_SHELLS}`}
          accent
        />
        <Tally label="Conseguidas" value={String(balance.earned)} />
        <Tally label="Lanzadas" value={String(balance.thrown)} />
        <Tally
          label="Recibidas"
          value={String(received.length)}
          suffix={owed > 0 ? `· ${owed} sin cumplir` : undefined}
        />
      </div>

      {/*
        Side by side on a wide screen, because the two lists are read against
        each other — what he threw versus what came back.
      */}
      <div className="grid gap-3 lg:grid-cols-2">
        <ShellFeed
          title="Lanzadas"
          rows={thrown.map((row) => ({
            id: row.id,
            who: row.toName ?? 'alguien',
            challenge: row.challengeName,
            at: row.thrownAt,
            done: Boolean(row.completedAt),
          }))}
          empty="Todavía no tiró ninguna."
        />
        <ShellFeed
          title="Recibidas"
          rows={received.map((row: ThrowRecord) => ({
            id: row.id,
            who: row.fromName ?? 'un espectador',
            challenge: row.challengeName,
            at: row.thrownAt,
            done: Boolean(row.completedAt),
          }))}
          empty="Todavía no le cayó ninguna."
        />
      </div>
    </div>
  );
}

function Tally({
  label,
  value,
  suffix,
  accent,
}: {
  label: string;
  value: string;
  suffix?: string;
  accent?: boolean;
}) {
  return (
    <div className="min-w-[7.5rem] flex-1 bg-carbon-2 px-3 py-2">
      <p className="text-[0.62rem] tracking-wide text-ink-3 uppercase">{label}</p>
      <p
        className="tabular mt-0.5 text-fluid-lg leading-none font-semibold"
        style={accent ? { color: 'var(--color-accent)' } : undefined}
      >
        {value}
        {suffix && (
          <span className="ml-1 text-[0.68rem] font-normal text-ink-3">
            {suffix}
          </span>
        )}
      </p>
    </div>
  );
}

interface FeedRow {
  id: string;
  who: string;
  challenge: string;
  at: number;
  done: boolean;
}

/**
 * A paged list of shells, one line per shell.
 *
 * Single line on purpose. The name, the punishment and the date are the whole
 * story, and stacking them cost three times the height to say the same thing —
 * which is why so few fit before. Status is a dot rather than a pill: it is one
 * bit of information and it was taking the width of a word.
 */
function ShellFeed({
  title,
  rows,
  empty,
}: {
  title: string;
  rows: FeedRow[];
  empty: string;
}) {
  const [page, setPage] = useState(0);

  const pages = Math.max(1, Math.ceil(rows.length / SHELL_PAGE_SIZE));
  // Clamped rather than reset by an effect: switching to a shorter player's
  // list while parked on page 4 should show that player's last page, not
  // flash an empty one and then correct itself.
  const current = Math.min(page, pages - 1);
  const slice = rows.slice(
    current * SHELL_PAGE_SIZE,
    current * SHELL_PAGE_SIZE + SHELL_PAGE_SIZE,
  );

  return (
    <section className="rounded-xl border border-line bg-carbon-2/40">
      <header className="flex items-center gap-2 border-b border-line px-3 py-2">
        <h3 className="eyebrow flex-1 text-ink-2">
          {title}
          <span className="ml-1.5 text-ink-3">{rows.length}</span>
        </h3>

        {pages > 1 && (
          <div className="flex items-center gap-1">
            <PageButton
              label="Anteriores"
              glyph="‹"
              disabled={current === 0}
              onClick={() => setPage(current - 1)}
            />
            <span className="tabular text-[0.68rem] text-ink-3">
              {current + 1}/{pages}
            </span>
            <PageButton
              label="Siguientes"
              glyph="›"
              disabled={current >= pages - 1}
              onClick={() => setPage(current + 1)}
            />
          </div>
        )}
      </header>

      {rows.length === 0 ? (
        <p className="px-3 py-6 text-center text-fluid-xs text-ink-3">{empty}</p>
      ) : (
        <ul>
          {slice.map((row) => (
            <li
              key={row.id}
              className="flex items-center gap-2 border-b border-line/50 px-3 py-1.5 transition-colors last:border-0 hover:bg-carbon-3/50"
            >
              <span
                aria-hidden="true"
                className="h-1.5 w-1.5 shrink-0 rounded-full"
                style={{
                  background: row.done
                    ? 'var(--color-mark-teal)'
                    : 'var(--color-accent)',
                }}
              />
              <span className="min-w-0 flex-1 truncate text-fluid-xs">
                <span className="font-medium">{row.who}</span>
                <span className="text-ink-3"> · {row.challenge}</span>
              </span>
              <span className="sr-only">
                {row.done ? 'Cumplido' : 'Pendiente'}
              </span>
              <span className="tabular shrink-0 text-[0.62rem] text-ink-3">
                {formatStamp(row.at)}
              </span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function PageButton({
  label,
  glyph,
  disabled,
  onClick,
}: {
  label: string;
  glyph: string;
  disabled: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      disabled={disabled}
      onClick={onClick}
      className={classNames(
        'flex h-6 w-6 items-center justify-center rounded-md border border-line text-fluid-xs transition-colors',
        disabled
          ? 'cursor-default text-ink-3/40'
          : 'text-ink-2 hover:border-line-strong hover:text-ink',
      )}
    >
      {glyph}
    </button>
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
