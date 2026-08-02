import { useCallback, useEffect, useState } from 'react';

import {
  createChallenge,
  fetchAdminChallenges,
  fetchDiscordUsers,
  linkDiscordUser,
  patchChallenge,
  removeChallenge,
  type AdminChallenge,
  type DiscordUser,
  type RosterPlayer,
} from '../lib/admin';
import { classNames, formatPercent } from './ui';

interface PanelLinksProps {
  code: string;
  roster: RosterPlayer[];
  onError: (message: string) => void;
}

/**
 * Two admin sections that only make sense together: who is allowed to fire a
 * shell, and what the wheel can land on.
 */
export function PanelLinks({ code, roster, onError }: PanelLinksProps) {
  const [users, setUsers] = useState<DiscordUser[]>([]);
  const [challenges, setChallenges] = useState<AdminChallenge[]>([]);
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    try {
      const [nextUsers, nextChallenges] = await Promise.all([
        fetchDiscordUsers(code),
        fetchAdminChallenges(code),
      ]);
      setUsers(nextUsers);
      setChallenges(nextChallenges);
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [code, onError]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (action: () => Promise<unknown>) => {
    setBusy(true);
    try {
      await action();
      await reload();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  // A player already spoken for is disabled in the other dropdowns, so the
  // one-to-one rule is visible before the request rather than after it.
  const takenBy = new Map(
    users
      .filter((user) => user.playerId)
      .map((user) => [user.playerId!, user.discordId]),
  );

  return (
    <div className="space-y-6">
      <section className="rounded-2xl border border-line bg-carbon p-4">
        <h3 className="display text-fluid-lg">Discord accounts</h3>
        <p className="mt-1 text-fluid-xs text-ink-3">
          Link each account to one roster player. One account, one player —
          picking someone already linked moves them.
        </p>

        {users.length === 0 ? (
          <p className="mt-4 text-fluid-sm text-ink-2">
            Nobody has signed in yet. Share the site and ask them to hit “Sign
            in with Discord”.
          </p>
        ) : (
          <ul className="mt-4 space-y-2">
            {users.map((user) => (
              <li
                key={user.discordId}
                className="flex flex-wrap items-center gap-3 rounded-xl border border-line bg-carbon-2 p-2.5"
              >
                {user.avatar ? (
                  <img
                    src={`https://cdn.discordapp.com/avatars/${user.discordId}/${user.avatar}.png?size=64`}
                    alt=""
                    width={32}
                    height={32}
                    className="h-8 w-8 rounded-full"
                  />
                ) : (
                  <span className="grid h-8 w-8 place-items-center rounded-full bg-carbon-3 text-[0.7rem]">
                    {user.username.slice(0, 2).toUpperCase()}
                  </span>
                )}

                <span className="min-w-0 flex-1 truncate text-fluid-sm">
                  {user.username}
                </span>

                <label className="flex items-center gap-2">
                  <span className="sr-only">
                    Roster player for {user.username}
                  </span>
                  <select
                    value={user.playerId ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      void run(() =>
                        linkDiscordUser(
                          code,
                          user.discordId,
                          event.target.value || null,
                        ),
                      )
                    }
                    className="min-h-10 rounded-lg border border-line bg-carbon px-3 text-fluid-sm text-ink"
                  >
                    <option value="">— not linked —</option>
                    {roster.map((player) => {
                      const owner = takenBy.get(player.id);
                      const takenByOther = owner && owner !== user.discordId;
                      return (
                        <option
                          key={player.id}
                          value={player.id}
                          disabled={Boolean(takenByOther)}
                        >
                          {player.displayName}
                          {takenByOther ? ' (already linked)' : ''}
                        </option>
                      );
                    })}
                  </select>
                </label>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ChallengeEditor
        challenges={challenges}
        busy={busy}
        onCreate={(input) => run(() => createChallenge(code, input))}
        onPatch={(id, input) => run(() => patchChallenge(code, id, input))}
        onDelete={(id) => run(() => removeChallenge(code, id))}
      />
    </div>
  );
}

function ChallengeEditor({
  challenges,
  busy,
  onCreate,
  onPatch,
  onDelete,
}: {
  challenges: AdminChallenge[];
  busy: boolean;
  onCreate: (input: { name: string; detail: string; weight: number }) => void;
  onPatch: (id: string, input: Partial<AdminChallenge>) => void;
  onDelete: (id: string) => void;
}) {
  const [draft, setDraft] = useState({ name: '', detail: '', weight: 3 });

  // Percentages are derived from the weights, so the editor shows the effect of
  // a change without anyone having to make the numbers add up to 100.
  const total =
    challenges
      .filter((challenge) => challenge.enabled)
      .reduce((sum, challenge) => sum + challenge.weight, 0) || 1;

  return (
    <section className="rounded-2xl border border-line bg-carbon p-4">
      <h3 className="display text-fluid-lg">The wheel</h3>
      <p className="mt-1 text-fluid-xs text-ink-3">
        Weights are relative, not percentages. Raise one and the rest adjust on
        their own.
      </p>

      <ul className="mt-4 space-y-2">
        {challenges.map((challenge) => (
          <li
            key={challenge.id}
            className={classNames(
              'flex flex-wrap items-center gap-2 rounded-xl border border-line bg-carbon-2 p-2.5',
              !challenge.enabled && 'opacity-50',
            )}
          >
            <span className="tabular w-12 shrink-0 text-fluid-xs text-ink-2">
              {challenge.enabled
                ? formatPercent(challenge.weight / total, 1)
                : '—'}
            </span>

            <span className="min-w-0 flex-1">
              <span className="block truncate text-fluid-sm">
                {challenge.name}
              </span>
              {challenge.detail && (
                <span className="block truncate text-[0.68rem] text-ink-3">
                  {challenge.detail}
                </span>
              )}
            </span>

            <label className="flex items-center gap-1.5">
              <span className="eyebrow text-ink-3">Weight</span>
              <input
                type="number"
                min={1}
                value={challenge.weight}
                disabled={busy}
                onChange={(event) =>
                  onPatch(challenge.id, {
                    weight: Math.max(Number(event.target.value) || 1, 1),
                  })
                }
                className="tabular min-h-9 w-16 rounded-lg border border-line bg-carbon px-2 text-fluid-sm"
              />
            </label>

            <button
              type="button"
              disabled={busy}
              onClick={() => onPatch(challenge.id, { enabled: !challenge.enabled })}
              className="eyebrow min-h-9 rounded-full border border-line px-3 text-ink-2 hover:text-ink"
            >
              {challenge.enabled ? 'Disable' : 'Enable'}
            </button>

            <button
              type="button"
              disabled={busy}
              onClick={() => onDelete(challenge.id)}
              className="eyebrow min-h-9 rounded-full border border-line px-3 text-ink-3 hover:text-ink"
            >
              Delete
            </button>
          </li>
        ))}
      </ul>

      <form
        className="mt-4 grid gap-2 border-t border-line pt-4 sm:grid-cols-[2fr_2fr_auto_auto]"
        onSubmit={(event) => {
          event.preventDefault();
          if (!draft.name.trim()) return;
          onCreate(draft);
          setDraft({ name: '', detail: '', weight: 3 });
        }}
      >
        <input
          value={draft.name}
          placeholder="New challenge"
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          className="min-h-10 rounded-lg border border-line bg-carbon-2 px-3 text-fluid-sm"
        />
        <input
          value={draft.detail}
          placeholder="Detail (optional)"
          onChange={(event) => setDraft({ ...draft, detail: event.target.value })}
          className="min-h-10 rounded-lg border border-line bg-carbon-2 px-3 text-fluid-sm"
        />
        <input
          type="number"
          min={1}
          value={draft.weight}
          onChange={(event) =>
            setDraft({ ...draft, weight: Math.max(Number(event.target.value) || 1, 1) })
          }
          className="tabular min-h-10 w-20 rounded-lg border border-line bg-carbon-2 px-3 text-fluid-sm"
        />
        <button
          type="submit"
          disabled={busy || !draft.name.trim()}
          className="eyebrow min-h-10 rounded-lg px-4 text-void disabled:opacity-40"
          style={{ background: 'var(--color-accent)' }}
        >
          Add
        </button>
      </form>
    </section>
  );
}
