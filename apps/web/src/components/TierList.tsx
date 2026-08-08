import { useCallback, useEffect, useMemo, useState } from 'react';

import {
  TIER_BRACKETS,
  bracketRange,
  tierColorHex,
  type RankedPlayer,
} from '@challenge/core/domain';

import {
  fetchTierBoard,
  placeOnTier,
  type Placement,
  type SessionUser,
  type TierMove,
} from '../lib/session';
import { TierCrest } from './icons';
import { Avatar, classNames } from './ui';
import { useDragDrop } from './useDragDrop';

/**
 * The shared tier list: one board, everyone edits it.
 *
 * Shared was a deliberate call over one-board-per-person, and the edit log is
 * what makes it survivable. Nothing is locked and nobody needs permission —
 * every move is attributed instead, which self-regulates far better than a
 * permission check nobody can argue with at 3am.
 *
 * The tiers are ladder brackets rather than S/A/B letters, so the board is a
 * prediction that the end of the challenge can actually settle.
 */

/** The tray, where anyone not yet placed waits. */
const TRAY = 'TRAY';

interface TierListProps {
  players: RankedPlayer[];
  user: SessionUser | null;
  token: string | null;
  /** Bumped by the dashboard's refresh cycle; a change refetches the board. */
  revision: number;
}

export function TierList({ players, user, token, revision }: TierListProps) {
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [moves, setMoves] = useState<TierMove[]>([]);
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);
  // Tap-to-pick, then tap a row. The keyboard path, and the one that saves a
  // long drag across a tall board on a phone.
  const [armed, setArmed] = useState<string | null>(null);

  const canEdit = Boolean(token && user?.playerId);

  const reload = useCallback(async () => {
    const board = await fetchTierBoard();
    setPlacements(board.placements);
    setMoves(board.moves);
  }, []);

  const byId = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );

  const tierOf = useMemo(
    () => new Map(placements.map((row) => [row.playerId, row.tierKey])),
    [placements],
  );

  const move = useCallback(
    async (playerId: string, zone: string) => {
      if (!token) return;

      const tierKey = zone === TRAY ? null : zone;
      if ((tierOf.get(playerId) ?? null) === tierKey) return;

      setError(null);
      // Applied locally first so the card lands where it was dropped instead of
      // snapping back until the server answers.
      setPlacements((current) => {
        const without = current.filter((row) => row.playerId !== playerId);
        if (tierKey === null) return without;
        return [
          ...without,
          {
            playerId,
            tierKey,
            position: Number.MAX_SAFE_INTEGER,
            updatedBy: user?.playerId ?? null,
            updatedAt: Date.now(),
          },
        ];
      });

      try {
        await placeOnTier(token, playerId, tierKey);
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : String(cause));
      }
      // Reloaded either way: on success it settles the real position, on
      // failure it puts the board back to what the server actually holds.
      await reload();
    },
    [token, tierOf, user, reload],
  );

  const { drag, start, justDragged } = useDragDrop<string>((playerId, zone) => {
    void move(playerId, zone);
  });

  // The dashboard's heartbeat pulls in other people's moves, but never mid-drag
  // or mid-pick: replacing the board under a held card would drop it somewhere
  // the user never chose.
  useEffect(() => {
    if (drag || armed) return;
    void reload();
  }, [revision, drag, armed, reload]);

  const onZone = (zone: string) => {
    if (!armed) return;
    void move(armed, zone);
    setArmed(null);
  };

  const unplaced = players.filter((player) => !tierOf.has(player.id));
  const visibleUnplaced = query.trim()
    ? unplaced.filter((player) =>
        player.displayName.toLowerCase().includes(query.trim().toLowerCase()),
      )
    : unplaced;

  return (
    <div className="space-y-4">
      <header className="flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="display text-fluid-lg">Tier list</h2>
          <p className="text-fluid-xs text-ink-3">
            Dónde creemos que termina cada uno. La edita cualquiera, y todo
            movimiento queda firmado.
          </p>
        </div>
        {!canEdit && (
          <p className="text-fluid-xs text-ink-3">
            Iniciá sesión para poder moverlos.
          </p>
        )}
      </header>

      {error && (
        <p
          role="alert"
          className="rounded-xl border border-line bg-carbon px-3 py-2 text-fluid-xs"
          style={{ color: 'var(--color-mark-red)' }}
        >
          {error}
        </p>
      )}

      <div className="grid gap-4 lg:grid-cols-[1fr_minmax(0,20rem)]">
        <div className="space-y-2">
          {TIER_BRACKETS.map((bracket) => {
            const inRow = placements
              .filter((row) => row.tierKey === bracket.key)
              .sort((a, b) => a.position - b.position)
              .map((row) => byId.get(row.playerId))
              .filter((player): player is RankedPlayer => Boolean(player));

            // A synthetic rank standing in for the bracket, so the crest and
            // the accent come from the same source the ranking table uses.
            const rank = {
              tier: bracket.tier,
              division: null,
              leaguePoints: bracket.minLp,
            };
            const accent = tierColorHex(rank);

            return (
              <section
                key={bracket.key}
                data-drop-zone={bracket.key}
                onClick={() => onZone(bracket.key)}
                className={classNames(
                  'grid grid-cols-[minmax(7rem,10rem)_1fr] overflow-hidden rounded-xl border transition-colors',
                  drag?.over === bracket.key || armed
                    ? 'border-accent'
                    : 'border-line',
                )}
                style={{
                  borderColor:
                    drag?.over === bracket.key ? accent : undefined,
                }}
              >
                <header
                  className="flex items-center gap-2 px-3 py-4"
                  style={{
                    background: `color-mix(in oklab, ${accent} 16%, transparent)`,
                    borderRight: `2px solid ${accent}`,
                  }}
                >
                  <TierCrest rank={rank} size={26} />
                  <span className="min-w-0">
                    <span className="display block truncate text-fluid-sm">
                      {bracket.label}
                    </span>
                    {bracketRange(bracket) && (
                      <span className="tabular block text-[0.65rem] text-ink-3">
                        {bracketRange(bracket)}
                      </span>
                    )}
                  </span>
                </header>

                <ul className="flex min-h-[4.5rem] flex-wrap content-start items-start gap-2 p-2">
                  {inRow.map((player) => (
                    <PlayerChip
                      key={player.id}
                      player={player}
                      draggable={canEdit}
                      dragging={drag?.item === player.id}
                      armed={armed === player.id}
                      onPointerDown={(event) => canEdit && start(event, player.id)}
                      justDragged={justDragged}
                      onToggleArm={() =>
                        setArmed(armed === player.id ? null : player.id)
                      }
                    />
                  ))}
                </ul>
              </section>
            );
          })}
        </div>

        <aside
          data-drop-zone={TRAY}
          onClick={() => onZone(TRAY)}
          className={classNames(
            'rounded-xl border bg-carbon p-4 transition-colors',
            drag?.over === TRAY ? 'border-accent' : 'border-line',
          )}
        >
          <header className="flex items-baseline justify-between gap-2">
            <h3 className="eyebrow">Participantes</h3>
            <span className="tabular text-fluid-xs text-ink-3">
              {unplaced.length}
            </span>
          </header>

          <input
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Buscar…"
            aria-label="Buscar participantes"
            className="mt-3 min-h-11 w-full rounded-xl border border-line bg-void px-3 text-fluid-sm"
          />

          <ul className="mt-3 flex flex-wrap gap-2">
            {visibleUnplaced.map((player) => (
              <PlayerChip
                key={player.id}
                player={player}
                draggable={canEdit}
                dragging={drag?.item === player.id}
                armed={armed === player.id}
                onPointerDown={(event) => canEdit && start(event, player.id)}
                justDragged={justDragged}
                onToggleArm={() =>
                  setArmed(armed === player.id ? null : player.id)
                }
              />
            ))}
          </ul>

          {unplaced.length === 0 && (
            <p className="mt-3 text-fluid-xs text-ink-3">
              Están todos colocados.
            </p>
          )}
        </aside>
      </div>

      <MoveLog moves={moves} />

      {/*
        The ghost follows the pointer outside the layout so it is never clipped
        by a row's overflow, and ignores pointer events so elementFromPoint sees
        the zone underneath rather than the ghost itself.
      */}
      {drag && (
        <div
          className="pointer-events-none fixed z-50 opacity-90"
          style={{ left: drag.x - drag.dx, top: drag.y - drag.dy }}
          aria-hidden
        >
          <Avatar
            name={byId.get(drag.item)?.displayName ?? '?'}
            iconId={byId.get(drag.item)?.profileIconId ?? null}
            size={44}
          />
        </div>
      )}
    </div>
  );
}

function PlayerChip({
  player,
  draggable,
  dragging,
  armed,
  onPointerDown,
  justDragged,
  onToggleArm,
}: {
  player: RankedPlayer;
  draggable: boolean;
  dragging: boolean;
  armed: boolean;
  onPointerDown: (event: React.PointerEvent) => void;
  justDragged: () => boolean;
  onToggleArm: () => void;
}) {
  return (
    <li>
      <button
        type="button"
        disabled={!draggable}
        onPointerDown={onPointerDown}
        // Belt and braces with draggable={false} on the avatar image: any
        // native drag starting here would cancel the pointer sequence.
        onDragStart={(event) => event.preventDefault()}
        onClick={(event) => {
          // The row underneath is also a drop zone; letting this bubble would
          // arm and immediately place in the same click.
          event.stopPropagation();
          // A drag ends with a click on the grabbed button, which would
          // otherwise arm the player you just dropped.
          if (justDragged()) return;
          onToggleArm();
        }}
        aria-pressed={armed}
        title={player.displayName}
        className={classNames(
          'flex w-16 select-none flex-col items-center gap-1 rounded-lg p-1 transition-opacity',
          // touch-none is what lets a drag start on a phone: without it the
          // browser claims the gesture for scrolling before pointermove fires.
          draggable && 'cursor-grab touch-none',
          dragging && 'opacity-30',
          armed && 'ring-2 ring-accent',
        )}
      >
        <Avatar
          name={player.displayName}
          iconId={player.profileIconId}
          size={44}
        />
        <span className="w-full truncate text-center text-[0.62rem] text-ink-2">
          {player.displayName}
        </span>
      </button>
    </li>
  );
}

/** Who moved whom, and when. The reason a shared board stays civil. */
function MoveLog({ moves }: { moves: TierMove[] }) {
  const label = (key: string | null) =>
    key === null
      ? 'la bandeja'
      : (TIER_BRACKETS.find((bracket) => bracket.key === key)?.label ?? key);

  return (
    <section className="rounded-2xl border border-line bg-carbon p-5">
      <h3 className="display text-fluid-lg">Movimientos</h3>

      {moves.length === 0 ? (
        <p className="mt-3 text-fluid-xs text-ink-3">
          Nadie movió nada todavía.
        </p>
      ) : (
        <ol className="mt-3 space-y-1">
          {moves.map((entry) => (
            <li key={entry.id} className="text-fluid-xs text-ink-2">
              <span className="text-ink">{entry.movedByName ?? 'Alguien'}</span>{' '}
              movió a{' '}
              <span className="text-ink">{entry.playerName ?? 'alguien'}</span>{' '}
              de {label(entry.fromTier)} a {label(entry.toTier)}
              <span className="text-ink-3">
                {' · '}
                {new Date(entry.movedAt).toLocaleString('es-AR')}
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  );
}
