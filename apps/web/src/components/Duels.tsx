import { useMemo } from 'react';

import type { RankedPlayer, Snapshot } from '@challenge/core/domain';

import { Avatar, formatPercent, tierColor } from './ui';

/**
 * Duels.
 *
 * `snapshot.headToHead` has been computed by the backend since the beginning
 * and rendered nowhere — a single line inside one player's card lists their
 * rivals, so the record between two people can only ever be read from one
 * side. This is that table, made public and ranked.
 *
 * Two different things live in the same record and are kept apart here:
 * meeting on opposite sides is a rivalry, meeting on the same side is a duo.
 * Merging them would rank a pair who queue together against a pair who keep
 * knocking each other out.
 */

interface Duel {
  a: RankedPlayer;
  b: RankedPlayer;
  /** Games on opposite teams. */
  against: number;
  /** Of those, how many `a` won. */
  aWins: number;
}

/** Below this a record is noise: one meeting is not a rivalry. */
const MINIMUM_MEETINGS = 2;
const TOP_N = 12;

export function Duels({
  players,
  headToHead,
}: {
  players: RankedPlayer[];
  headToHead: Snapshot['headToHead'];
}) {
  const byId = useMemo(
    () => new Map(players.map((player) => [player.id, player])),
    [players],
  );

  const duels = useMemo<Duel[]>(
    () =>
      headToHead
        .map((record) => {
          const a = byId.get(record.playerA);
          const b = byId.get(record.playerB);
          if (!a || !b) return null;
          return {
            a,
            b,
            against: record.against,
            aWins: record.aWonAgainst,
          } satisfies Duel;
        })
        .filter((duel): duel is Duel => duel !== null)
        .filter((duel) => duel.against >= MINIMUM_MEETINGS)
        // Most-contested first: the number of meetings is what makes a rivalry
        // worth reading, not how lopsided it turned out.
        .sort((x, y) => y.against - x.against)
        .slice(0, TOP_N),
    [headToHead, byId],
  );

  /**
   * Who owns whom. A player's nemesis is whoever has the best record against
   * them — the one line every reader looks for first, and the one the
   * per-player card could never show, because it only ever had one side.
   */
  const nemeses = useMemo(() => {
    const worst = new Map<string, { rival: RankedPlayer; losses: number; total: number }>();

    for (const record of headToHead) {
      const a = byId.get(record.playerA);
      const b = byId.get(record.playerB);
      if (!a || !b || record.against < MINIMUM_MEETINGS) continue;

      const consider = (
        victim: RankedPlayer,
        rival: RankedPlayer,
        losses: number,
      ) => {
        if (losses <= record.against / 2) return;
        const current = worst.get(victim.id);
        if (!current || losses > current.losses) {
          worst.set(victim.id, { rival, losses, total: record.against });
        }
      };

      consider(a, b, record.against - record.aWonAgainst);
      consider(b, a, record.aWonAgainst);
    }

    return [...worst.entries()]
      .map(([id, entry]) => ({ victim: byId.get(id)!, ...entry }))
      .filter((row) => row.victim)
      .sort((x, y) => y.losses - x.losses)
      .slice(0, 8);
  }, [headToHead, byId]);

  if (duels.length === 0) {
    return (
      <p className="rounded-xl border border-line bg-carbon px-4 py-12 text-center text-fluid-sm text-ink-3">
        Todavía nadie se ha cruzado en pista las veces suficientes. Los duelos
        aparecen a partir de {MINIMUM_MEETINGS} encuentros.
      </p>
    );
  }

  return (
    <div className="space-y-4">
      <section className="rounded-xl border border-line bg-carbon px-4 py-4">
        <header className="mb-4">
          <h3 className="display text-fluid-lg leading-none">
            Cara a cara
          </h3>
          <p className="text-fluid-xs text-ink-3">
            Partidas en equipos contrarios, las más disputadas primero
          </p>
        </header>

        <ul className="grid gap-2 lg:grid-cols-2">
          {duels.map((duel) => (
            <DuelRow key={`${duel.a.id}-${duel.b.id}`} duel={duel} />
          ))}
        </ul>
      </section>

      {nemeses.length > 0 && (
        <section className="rounded-xl border border-line bg-carbon px-4 py-4">
          <header className="mb-4">
            <h3 className="display text-fluid-lg leading-none">Bestias negras</h3>
            <p className="text-fluid-xs text-ink-3">
              A quién no consigue ganarle cada uno
            </p>
          </header>

          <ul className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {nemeses.map((row) => (
              <li
                key={row.victim.id}
                className="rounded-md border border-line bg-carbon-2 px-3 py-2.5"
              >
                <div className="flex items-center gap-2">
                  <Avatar
                    name={row.victim.displayName}
                    iconId={row.victim.profileIconId}
                    size={26}
                  />
                  <p className="min-w-0 flex-1 truncate text-fluid-xs text-ink-2">
                    {row.victim.displayName}
                  </p>
                </div>

                <p className="eyebrow mt-2 text-ink-3">pierde contra</p>

                <div className="mt-1 flex items-center gap-2">
                  <Avatar
                    name={row.rival.displayName}
                    iconId={row.rival.profileIconId}
                    size={26}
                  />
                  <p
                    className="min-w-0 flex-1 truncate text-fluid-sm"
                    style={{ color: tierColor(row.rival.rank) }}
                  >
                    {row.rival.displayName}
                  </p>
                  <span
                    className="tabular shrink-0 text-fluid-sm"
                    style={{ color: 'var(--color-mark-red)' }}
                  >
                    {row.losses}/{row.total}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

/**
 * One rivalry. The bar is the record itself — left side is A's wins, right side
 * is B's — so a 6-1 and a 4-3 look nothing alike before either number is read.
 */
function DuelRow({ duel }: { duel: Duel }) {
  const bWins = duel.against - duel.aWins;
  const aShare = duel.against > 0 ? duel.aWins / duel.against : 0.5;
  const aLeads = duel.aWins > bWins;
  const level = duel.aWins === bWins;

  return (
    <li className="rounded-md border border-line bg-carbon-2 px-3 py-2.5">
      <div className="flex items-center gap-2">
        <Avatar name={duel.a.displayName} iconId={duel.a.profileIconId} size={28} />
        <p
          className="min-w-0 flex-1 truncate text-fluid-sm"
          style={{ color: aLeads ? tierColor(duel.a.rank) : undefined }}
        >
          {duel.a.displayName}
        </p>

        <p className="tabular shrink-0 px-2 text-fluid-base">
          <span style={{ color: aLeads ? 'var(--color-mark-teal)' : undefined }}>
            {duel.aWins}
          </span>
          <span className="px-1 text-ink-3">–</span>
          <span
            style={{
              color: !aLeads && !level ? 'var(--color-mark-teal)' : undefined,
            }}
          >
            {bWins}
          </span>
        </p>

        <p
          className="min-w-0 flex-1 truncate text-right text-fluid-sm"
          style={{ color: !aLeads && !level ? tierColor(duel.b.rank) : undefined }}
        >
          {duel.b.displayName}
        </p>
        <Avatar name={duel.b.displayName} iconId={duel.b.profileIconId} size={28} />
      </div>

      <div className="mt-2 flex h-1.5 overflow-hidden rounded-sm bg-carbon-3">
        <span
          style={{
            width: `${aShare * 100}%`,
            background: 'var(--color-mark-blue)',
          }}
        />
        <span
          style={{
            width: `${(1 - aShare) * 100}%`,
            background: 'var(--color-mark-magenta)',
          }}
        />
      </div>

      <p className="eyebrow mt-1.5 text-ink-3">
        {duel.against} encuentros ·{' '}
        {level ? 'empate' : `${formatPercent(Math.max(aShare, 1 - aShare), 0)} para ${aLeads ? duel.a.displayName : duel.b.displayName}`}
      </p>
    </li>
  );
}
