import { useCallback, useEffect, useState } from 'react';

import {
  createChallenge,
  fetchAdminChallenges,
  fetchDiscordUsers,
  linkDiscordUser,
  patchChallenge,
  removeChallenge,
  setDiscordAdmin,
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
  // Selecting from a dropdown saves immediately, which is fine, but silent.
  // This is the acknowledgement that the change actually landed.
  const [saved, setSaved] = useState<string | null>(null);

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

  const run = async (action: () => Promise<unknown>, savedKey?: string) => {
    setBusy(true);
    try {
      await action();
      await reload();
      if (savedKey) {
        setSaved(savedKey);
        setTimeout(() => setSaved((current) => (current === savedKey ? null : current)), 2500);
      }
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
        <h3 className="display text-fluid-lg">Cuentas de Discord</h3>
        <p className="mt-1 text-fluid-xs text-ink-3">
          Vinculá cada cuenta con un jugador del roster. Una cuenta, un jugador —
          si elegís a alguien ya vinculado, se lo mueve.
        </p>
        <p className="mt-1 text-fluid-xs text-ink-3">
          “Admin” es aparte del código de este panel: es lo que habilita forzar
          un reto y dispararse a uno mismo desde Conchas Azules.
        </p>

        {users.length === 0 ? (
          <p className="mt-4 text-fluid-sm text-ink-2">
            Todavía no entró nadie. Compartí el sitio y pediles que toquen
            “Entrar con Discord”.
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

                <span className="min-w-0 flex-1">
                  <span className="block truncate text-fluid-sm">
                    {user.username}
                  </span>
                  <span className="block truncate text-[0.68rem]">
                    {saved === user.discordId ? (
                      <span style={{ color: 'var(--color-mark-teal)' }}>
                        Guardado
                      </span>
                    ) : user.playerId ? (
                      <span className="text-ink-3">
                        vinculado a{' '}
                        <span style={{ color: 'var(--color-accent)' }}>
                          {roster.find((player) => player.id === user.playerId)
                            ?.displayName ?? 'jugador desconocido'}
                        </span>
                      </span>
                    ) : (
                      <span className="text-ink-3">sin vincular</span>
                    )}
                  </span>
                </span>

                <button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(
                      () =>
                        setDiscordAdmin(code, user.discordId, !user.isAdmin),
                      user.discordId,
                    )
                  }
                  className={classNames(
                    'eyebrow min-h-10 shrink-0 rounded-full border px-3 transition-colors',
                    user.isAdmin
                      ? 'border-transparent text-void'
                      : 'border-line text-ink-3 hover:text-ink',
                  )}
                  style={
                    user.isAdmin
                      ? { background: 'var(--color-accent)' }
                      : undefined
                  }
                  aria-pressed={user.isAdmin}
                >
                  Admin
                </button>

                <label className="flex items-center gap-2">
                  <span className="sr-only">
                    Jugador del roster para {user.username}
                  </span>
                  <select
                    value={user.playerId ?? ''}
                    disabled={busy}
                    onChange={(event) =>
                      void run(
                        () =>
                          linkDiscordUser(
                            code,
                            user.discordId,
                            event.target.value || null,
                          ),
                        user.discordId,
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

/**
 * One editable challenge.
 *
 * Fields keep local state and save on blur rather than on every keystroke:
 * typing a name would otherwise fire a request per character.
 */
function ChallengeRow({
  challenge,
  share,
  busy,
  onPatch,
  onDelete,
}: {
  challenge: AdminChallenge;
  share: number | null;
  busy: boolean;
  onPatch: (input: Partial<AdminChallenge>) => void;
  onDelete: () => void;
}) {
  const [name, setName] = useState(challenge.name);
  const [detail, setDetail] = useState(challenge.detail);
  const [weight, setWeight] = useState(String(challenge.weight));
  const [confirming, setConfirming] = useState(false);

  // Someone else may have edited this row; adopt the server's version unless
  // this field is the one being typed in.
  useEffect(() => setName(challenge.name), [challenge.name]);
  useEffect(() => setDetail(challenge.detail), [challenge.detail]);
  useEffect(() => setWeight(String(challenge.weight)), [challenge.weight]);

  return (
    <li
      className={classNames(
        'rounded-xl border border-line bg-carbon-2 p-2.5',
        !challenge.enabled && 'opacity-50',
      )}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="tabular w-12 shrink-0 text-fluid-xs text-ink-2">
          {share === null ? '—' : formatPercent(share, 1)}
        </span>

        <input
          value={name}
          disabled={busy}
          onChange={(event) => setName(event.target.value)}
          onBlur={() => {
            const trimmed = name.trim();
            if (!trimmed) return setName(challenge.name);
            if (trimmed !== challenge.name) onPatch({ name: trimmed });
          }}
          placeholder="Reto"
          className="min-h-9 min-w-0 flex-[2] rounded-lg border border-line bg-carbon px-2 text-fluid-sm"
        />

        <label className="flex shrink-0 items-center gap-1.5">
          <span className="eyebrow text-ink-3">Peso</span>
          <input
            type="number"
            min={1}
            value={weight}
            disabled={busy}
            onChange={(event) => setWeight(event.target.value)}
            onBlur={() => {
              const parsed = Math.max(Number(weight) || 1, 1);
              if (parsed !== challenge.weight) onPatch({ weight: parsed });
              setWeight(String(parsed));
            }}
            className="tabular min-h-9 w-16 rounded-lg border border-line bg-carbon px-2 text-fluid-sm"
          />
        </label>

        <button
          type="button"
          disabled={busy}
          onClick={() => onPatch({ enabled: !challenge.enabled })}
          className="eyebrow min-h-9 shrink-0 rounded-full border border-line px-3 text-ink-2 hover:text-ink"
        >
          {challenge.enabled ? 'Desactivar' : 'Activar'}
        </button>

        {confirming ? (
          <span className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              disabled={busy}
              onClick={onDelete}
              className="eyebrow min-h-9 rounded-full px-3 text-void"
              style={{ background: 'var(--color-mark-red)' }}
            >
              Eliminar
            </button>
            <button
              type="button"
              onClick={() => setConfirming(false)}
              className="eyebrow min-h-9 px-2 text-ink-3"
            >
              Cancelar
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setConfirming(true)}
            className="eyebrow min-h-9 shrink-0 rounded-full border border-line px-3 text-ink-3 hover:text-ink"
          >
            Eliminar
          </button>
        )}
      </div>

      <input
        value={detail}
        disabled={busy}
        onChange={(event) => setDetail(event.target.value)}
        onBlur={() => {
          if (detail !== challenge.detail) onPatch({ detail });
        }}
        placeholder="Detalle (opcional)"
        className="mt-1.5 min-h-8 w-full rounded-lg border border-line bg-carbon px-2 text-[0.72rem] text-ink-2 placeholder:text-ink-3"
      />
    </li>
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
      <h3 className="display text-fluid-lg">La ruleta</h3>
      <p className="mt-1 text-fluid-xs text-ink-3">
        Los pesos son relativos, no porcentajes. Subí uno y el resto se ajusta
        solo.
      </p>

      <ul className="mt-4 space-y-2">
        {challenges.map((challenge) => (
          <ChallengeRow
            key={challenge.id}
            challenge={challenge}
            share={challenge.enabled ? challenge.weight / total : null}
            busy={busy}
            onPatch={(input) => onPatch(challenge.id, input)}
            onDelete={() => onDelete(challenge.id)}
          />
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
          placeholder="Nuevo reto"
          onChange={(event) => setDraft({ ...draft, name: event.target.value })}
          className="min-h-10 rounded-lg border border-line bg-carbon-2 px-3 text-fluid-sm"
        />
        <input
          value={draft.detail}
          placeholder="Detalle (opcional)"
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
          Agregar
        </button>
      </form>
    </section>
  );
}
