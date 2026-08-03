import { useCallback, useEffect, useState } from 'react';

import type { RankedPlayer } from '@challenge/core/domain';

import { API_URL } from '../lib/api';
import { Avatar, classNames, tierColor } from './ui';

interface LiveParticipant {
  championId: number;
  championName: string;
  championIcon: string;
  teamId: number;
  riotId: string | null;
  playerId: string | null;
  displayName: string | null;
}

interface LiveGame {
  gameId: number;
  queueId: number;
  queueLabel: string;
  gameLength: number;
  trackedPlayerIds: string[];
  inChampSelect: boolean;
  countsForChallenge: boolean;
  allies: LiveParticipant[];
  enemies: LiveParticipant[];
}

/** Matches the sync cadence: fetching faster would only show the same answer. */
const POLL_MS = 30_000;

export function LiveGames({ players }: { players: RankedPlayer[] }) {
  const [games, setGames] = useState<LiveGame[] | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`${API_URL}/api/live?t=${Date.now()}`, {
        cache: 'no-store',
      });
      if (!response.ok) throw new Error(String(response.status));
      setGames(((await response.json()) as { games: LiveGame[] }).games);
      setError(false);
    } catch {
      setError(true);
    }
  }, []);

  useEffect(() => {
    void load();
    const id = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(id);
  }, [load]);

  if (error) {
    return (
      <Empty
        title="No se puede conectar al backend"
        detail="Las partidas en vivo vienen del servidor, que ahora no responde."
      />
    );
  }

  if (games === null) {
    return <Empty title="Buscando partidas…" detail="Un momento." />;
  }

  if (games.length === 0) {
    return (
      <Empty
        title="Nadie está jugando"
        detail="Las partidas aparecen acá a los pocos minutos de empezar. La herramienta de práctica nunca aparece — Riot solo publica partidas que se pueden espectar."
      />
    );
  }

  return (
    <div className="space-y-4">
      {games.map((game) => (
        <GameCard key={game.gameId} game={game} players={players} />
      ))}
    </div>
  );
}

function GameCard({
  game,
  players,
}: {
  game: LiveGame;
  players: RankedPlayer[];
}) {
  const tracked = players.filter((player) =>
    game.trackedPlayerIds.includes(player.id),
  );

  return (
    <section className="overflow-hidden rounded-2xl border border-line bg-carbon">
      <header className="flex flex-wrap items-center gap-3 border-b border-line p-4">
        <span
          aria-hidden="true"
          className="live-dot h-2.5 w-2.5 shrink-0 rounded-full"
          style={{ background: 'var(--color-mark-teal)' }}
        />

        <div className="min-w-0 flex-1">
          <p className="display truncate text-fluid-sm">
            {tracked.map((player) => player.displayName).join(' · ') ||
              'Jugador seguido'}
          </p>
          <p className="flex flex-wrap items-center gap-1.5 text-[0.68rem] text-ink-3">
            {game.queueLabel}
            {!game.countsForChallenge && (
              <span
                className="rounded px-1 py-px"
                style={{
                  color: 'var(--color-mark-amber)',
                  background:
                    'color-mix(in oklab, var(--color-mark-amber) 16%, transparent)',
                }}
                title="Esta cola no cuenta para el challenge"
              >
                no cuenta
              </span>
            )}
          </p>
        </div>

        <div className="flex items-center gap-2">
          {tracked.map((player) => (
            <Avatar
              key={player.id}
              name={player.displayName}
              iconId={player.profileIconId}
              size={30}
              ring={tierColor(player.rank)}
            />
          ))}
        </div>

        <span className="tabular text-fluid-sm text-ink-2">
          {game.inChampSelect ? 'Champ select' : formatLength(game.gameLength)}
        </span>
      </header>

      <div className="grid gap-px bg-line sm:grid-cols-2">
        <Side title="Their team" participants={game.allies} highlight />
        <Side title="Enemies" participants={game.enemies} />
      </div>
    </section>
  );
}

function Side({
  title,
  participants,
  highlight,
}: {
  title: string;
  participants: LiveParticipant[];
  highlight?: boolean;
}) {
  return (
    <div className="bg-carbon p-4">
      <h4
        className="eyebrow"
        style={{
          color: highlight ? 'var(--color-mark-teal)' : 'var(--color-mark-red)',
        }}
      >
        {title}
      </h4>

      <ul className="mt-3 space-y-1.5">
        {participants.map((participant) => (
          <li
            key={`${participant.championId}-${participant.riotId ?? Math.random()}`}
            className={classNames(
              'flex items-center gap-2.5 rounded-lg p-1.5',
              // A tracked player is the reason anyone opened this tab, so they
              // get the only emphasis on the card.
              participant.playerId ? 'bg-carbon-2' : '',
            )}
            style={
              participant.playerId
                ? { boxShadow: 'inset 0 0 0 1px var(--color-accent)' }
                : undefined
            }
          >
            <img
              src={participant.championIcon}
              alt=""
              width={30}
              height={30}
              loading="lazy"
              className="h-[30px] w-[30px] shrink-0 rounded-md bg-carbon-3 ring-1 ring-line"
            />

            <span className="min-w-0 flex-1">
              <span
                className={classNames(
                  'block truncate text-fluid-sm',
                  participant.playerId && 'display',
                )}
                style={
                  participant.playerId
                    ? { color: 'var(--color-accent)' }
                    : undefined
                }
              >
                {participant.displayName ?? participant.riotId ?? 'Unknown'}
              </span>
              <span className="block truncate text-[0.68rem] text-ink-3">
                {participant.championName}
              </span>
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Empty({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-2xl border border-line bg-carbon p-10 text-center">
      <p className="display text-fluid-lg">{title}</p>
      <p className="mx-auto mt-2 max-w-md text-fluid-sm text-ink-2">{detail}</p>
    </div>
  );
}

function formatLength(seconds: number): string {
  const safe = Math.max(seconds, 0);
  const minutes = Math.floor(safe / 60);
  return `${minutes}:${String(Math.floor(safe % 60)).padStart(2, '0')}`;
}
