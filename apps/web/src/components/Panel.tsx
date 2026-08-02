import { useCallback, useEffect, useState } from 'react';

import { ROLES, opggUrl, type Role } from '@challenge/core/domain';

import {
  ApiError,
  addPlayer,
  clearCode,
  editPlayer,
  fetchInfo,
  fetchRoster,
  readCode,
  removePlayer,
  setVisible,
  storeCode,
  type PanelInfo,
  type RosterPlayer,
} from '../lib/admin';
import { PanelLinks } from './PanelLinks';
import { RoleIcon } from './icons';
import { OpggLink, ROLE_LABEL, classNames } from './ui';

type Draft = {
  displayName: string;
  gameName: string;
  tagLine: string;
  role: Role;
};

const EMPTY_DRAFT: Draft = {
  displayName: '',
  gameName: '',
  tagLine: '',
  role: 'MID',
};

export function Panel() {
  const [code, setCode] = useState('');
  const [unlocked, setUnlocked] = useState(false);
  const [info, setInfo] = useState<PanelInfo | null>(null);
  const [roster, setRoster] = useState<RosterPlayer[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // The stored code is only readable after mount, so the gate must not render
  // before that check finishes — otherwise it flashes and vanishes on its own.
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    fetchInfo().then(setInfo).catch(() => setInfo(null));
    const stored = readCode();
    if (stored) {
      setCode(stored);
      void unlock(stored).finally(() => setChecking(false));
    } else {
      setChecking(false);
    }
    // Runs once: the stored code is read on mount and never re-read.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const unlock = useCallback(async (candidate: string) => {
    setBusy(true);
    try {
      setRoster(await fetchRoster(candidate));
      storeCode(candidate);
      setUnlocked(true);
      setError(null);
    } catch (cause) {
      setUnlocked(false);
      clearCode();
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  }, []);

  const reload = useCallback(async () => {
    try {
      setRoster(await fetchRoster(code));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    }
  }, [code]);

  /** Wraps every mutation so errors surface in one place instead of per button. */
  const run = useCallback(
    async (action: () => Promise<unknown>, success?: string) => {
      setBusy(true);
      setError(null);
      setNotice(null);
      try {
        await action();
        await reload();
        if (success) setNotice(success);
        return true;
      } catch (cause) {
        setError(
          cause instanceof ApiError || cause instanceof Error
            ? cause.message
            : String(cause),
        );
        return false;
      } finally {
        setBusy(false);
      }
    },
    [reload],
  );

  if (checking) {
    return (
      <p className="py-16 text-center text-fluid-sm text-ink-3" role="status">
        Checking your saved code…
      </p>
    );
  }

  if (!unlocked) {
    return (
      <CodeGate
        code={code}
        onCodeChange={setCode}
        onSubmit={() => void unlock(code)}
        busy={busy}
        error={error}
        info={info}
      />
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="display text-fluid-lg">Roster</h2>
          <p className="text-fluid-xs text-ink-3">
            {roster.filter((p) => p.status === 'approved').length} on the board
            {info && ` · ${info.platform} · ${info.source} data`}
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => {
              clearCode();
              setUnlocked(false);
              setCode('');
            }}
            className="eyebrow min-h-10 rounded-full border border-line px-4 text-ink-3 transition-colors hover:text-ink"
          >
            Lock
          </button>
        </div>
      </div>

      {error && <Banner tone="error">{error}</Banner>}
      {notice && <Banner tone="ok">{notice}</Banner>}

      <AddPlayerForm
        busy={busy}
        onAdd={(draft) =>
          run(() => addPlayer(code, draft), `${draft.gameName} added.`)
        }
      />

      <ul className="space-y-2">
        {roster.map((player) => (
          <PlayerRow
            key={player.id}
            player={player}
            platform={info?.platform ?? 'euw1'}
            busy={busy}
            onSave={(draft) =>
              run(async () => {
                const result = await editPlayer(code, player.id, draft);
                if (result.statsReset) {
                  setNotice(
                    'Riot ID changed, so the accumulated stats for that player were cleared.',
                  );
                }
              }, 'Saved.')
            }
            onToggle={() =>
              run(() =>
                setVisible(code, player.id, player.status !== 'approved'),
              )
            }
            onDelete={() =>
              run(() => removePlayer(code, player.id), 'Player removed.')
            }
          />
        ))}
      </ul>

      {roster.length === 0 && (
        <p className="rounded-2xl border border-line bg-carbon p-8 text-center text-ink-2">
          Nobody on the roster yet. Add the first player above.
        </p>
      )}

      <PanelLinks code={code} roster={roster} onError={setError} />
    </div>
  );
}

function CodeGate({
  code,
  onCodeChange,
  onSubmit,
  busy,
  error,
  info,
}: {
  code: string;
  onCodeChange: (value: string) => void;
  onSubmit: () => void;
  busy: boolean;
  error: string | null;
  info: PanelInfo | null;
}) {
  return (
    <div className="mx-auto max-w-md rounded-2xl border border-line bg-carbon p-6">
      <h2 className="display text-fluid-lg">Enter the group code</h2>
      <p className="mt-2 text-fluid-sm text-ink-2">
        Whoever has this code can edit the roster. Ask in the group chat.
      </p>

      <form
        className="mt-5 space-y-3"
        onSubmit={(event) => {
          event.preventDefault();
          onSubmit();
        }}
      >
        <label className="block">
          <span className="sr-only">Group code</span>
          <input
            type="password"
            value={code}
            autoComplete="current-password"
            onChange={(event) => onCodeChange(event.target.value)}
            placeholder="Group code"
            className="min-h-11 w-full rounded-lg border border-line bg-carbon-2 px-3 text-fluid-sm text-ink placeholder:text-ink-3 focus:border-[color:var(--color-accent)]"
          />
        </label>

        <button
          type="submit"
          disabled={busy || !code}
          className="eyebrow min-h-11 w-full rounded-lg px-4 text-void transition-opacity disabled:opacity-40"
          style={{ background: 'var(--color-accent)' }}
        >
          {busy ? 'Checking…' : 'Unlock'}
        </button>
      </form>

      {error && (
        <p className="mt-3 text-fluid-xs" style={{ color: 'var(--color-mark-red)' }}>
          {error}
        </p>
      )}
      {!info && (
        <p className="mt-3 text-fluid-xs text-ink-3">
          The backend is not answering. Check that it is running and that this
          site's URL is in its ALLOWED_ORIGINS.
        </p>
      )}
    </div>
  );
}

function AddPlayerForm({
  busy,
  onAdd,
}: {
  busy: boolean;
  onAdd: (draft: Draft) => Promise<boolean>;
}) {
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);

  return (
    <form
      className="rounded-2xl border border-line bg-carbon p-4"
      onSubmit={async (event) => {
        event.preventDefault();
        // Only clear the fields once the player actually exists. A rejected
        // Riot ID or a dead backend must not cost someone their typing.
        if (await onAdd(draft)) setDraft(EMPTY_DRAFT);
      }}
    >
      <h3 className="eyebrow text-ink-3">Add a player</h3>

      <div className="mt-3 grid gap-2 sm:grid-cols-[1fr_1fr_auto_auto_auto]">
        <Field
          label="Riot name"
          value={draft.gameName}
          onChange={(gameName) => setDraft({ ...draft, gameName })}
          placeholder="Reddsito"
        />
        <Field
          label="Tag"
          value={draft.tagLine}
          onChange={(tagLine) => setDraft({ ...draft, tagLine })}
          placeholder="EUW"
        />
        <Field
          label="Display name"
          value={draft.displayName}
          onChange={(displayName) => setDraft({ ...draft, displayName })}
          placeholder="optional"
        />
        <RoleSelect
          value={draft.role}
          onChange={(role) => setDraft({ ...draft, role })}
        />
        <button
          type="submit"
          disabled={busy || !draft.gameName || !draft.tagLine}
          className="eyebrow min-h-10 self-end rounded-lg px-4 text-void transition-opacity disabled:opacity-40"
          style={{ background: 'var(--color-accent)' }}
        >
          Add
        </button>
      </div>
    </form>
  );
}

function PlayerRow({
  player,
  platform,
  busy,
  onSave,
  onToggle,
  onDelete,
}: {
  player: RosterPlayer;
  platform: string;
  busy: boolean;
  onSave: (draft: Draft) => Promise<boolean>;
  onToggle: () => void;
  onDelete: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<Draft>({
    displayName: player.displayName,
    gameName: player.gameName,
    tagLine: player.tagLine,
    role: player.role,
  });
  const [confirming, setConfirming] = useState(false);

  const hidden = player.status !== 'approved';

  if (editing) {
    return (
      <li className="rounded-xl border border-line bg-carbon p-3">
        <div className="grid gap-2 sm:grid-cols-[1fr_1fr_1fr_auto]">
          <Field
            label="Riot name"
            value={draft.gameName}
            onChange={(gameName) => setDraft({ ...draft, gameName })}
          />
          <Field
            label="Tag"
            value={draft.tagLine}
            onChange={(tagLine) => setDraft({ ...draft, tagLine })}
          />
          <Field
            label="Display name"
            value={draft.displayName}
            onChange={(displayName) => setDraft({ ...draft, displayName })}
          />
          <RoleSelect
            value={draft.role}
            onChange={(role) => setDraft({ ...draft, role })}
          />
        </div>

        {(draft.gameName.toLowerCase() !== player.gameName.toLowerCase() ||
          draft.tagLine.toLowerCase() !== player.tagLine.toLowerCase()) && (
          <p
            className="mt-2 text-fluid-xs"
            style={{ color: 'var(--color-mark-amber)' }}
          >
            Changing the Riot ID points this row at a different account, so its
            accumulated stats will be cleared.
          </p>
        )}

        <div className="mt-3 flex gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={async () => {
              if (await onSave(draft)) setEditing(false);
            }}
            className="eyebrow min-h-9 rounded-full px-4 text-void disabled:opacity-40"
            style={{ background: 'var(--color-accent)' }}
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => setEditing(false)}
            className="eyebrow min-h-9 rounded-full border border-line px-4 text-ink-2"
          >
            Cancel
          </button>
        </div>
      </li>
    );
  }

  return (
    <li
      className={classNames(
        'flex flex-wrap items-center gap-3 rounded-xl border border-line bg-carbon p-3',
        hidden && 'opacity-55',
      )}
    >
      <span className="text-ink-2" title={ROLE_LABEL[player.role]}>
        <RoleIcon role={player.role} size={18} />
      </span>

      <div className="min-w-0 flex-1">
        <p className="display truncate text-fluid-sm">
          {player.displayName}
          {hidden && (
            <span className="eyebrow ml-2 text-ink-3">hidden</span>
          )}
        </p>
        <p className="truncate text-[0.68rem] text-ink-3">
          {player.gameName}#{player.tagLine}
        </p>
      </div>

      <OpggLink url={opggUrl(platform, player.gameName, player.tagLine)} />

      <button
        type="button"
        onClick={() => setEditing(true)}
        className="eyebrow min-h-9 rounded-full border border-line px-3 text-ink-2 transition-colors hover:text-ink"
      >
        Edit
      </button>

      <button
        type="button"
        disabled={busy}
        onClick={onToggle}
        className="eyebrow min-h-9 rounded-full border border-line px-3 text-ink-2 transition-colors hover:text-ink disabled:opacity-40"
        title={
          hidden
            ? 'Show this player on the leaderboard'
            : 'Hide from the leaderboard without deleting their stats'
        }
      >
        {hidden ? 'Show' : 'Hide'}
      </button>

      {confirming ? (
        <span className="flex items-center gap-2">
          <button
            type="button"
            disabled={busy}
            onClick={onDelete}
            className="eyebrow min-h-9 rounded-full px-3 text-void disabled:opacity-40"
            style={{ background: 'var(--color-mark-red)' }}
          >
            Delete for good
          </button>
          <button
            type="button"
            onClick={() => setConfirming(false)}
            className="eyebrow min-h-9 px-2 text-ink-3"
          >
            Cancel
          </button>
        </span>
      ) : (
        <button
          type="button"
          onClick={() => setConfirming(true)}
          className="eyebrow min-h-9 rounded-full border border-line px-3 text-ink-3 transition-colors hover:text-ink"
          title="Removes the player and every stat collected for them"
        >
          Delete
        </button>
      )}
    </li>
  );
}

function Field({
  label,
  value,
  onChange,
  placeholder,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}) {
  return (
    <label className="block">
      <span className="eyebrow block text-ink-3">{label}</span>
      <input
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="mt-1 min-h-10 w-full rounded-lg border border-line bg-carbon-2 px-3 text-fluid-sm text-ink placeholder:text-ink-3 focus:border-[color:var(--color-accent)]"
      />
    </label>
  );
}

function RoleSelect({
  value,
  onChange,
}: {
  value: Role;
  onChange: (role: Role) => void;
}) {
  return (
    <label className="block">
      <span className="eyebrow block text-ink-3">Role</span>
      <select
        value={value}
        onChange={(event) => onChange(event.target.value as Role)}
        className="mt-1 min-h-10 w-full rounded-lg border border-line bg-carbon-2 px-3 text-fluid-sm text-ink"
      >
        {ROLES.map((role) => (
          <option key={role} value={role}>
            {ROLE_LABEL[role]}
          </option>
        ))}
      </select>
    </label>
  );
}

function Banner({
  tone,
  children,
}: {
  tone: 'error' | 'ok';
  children: React.ReactNode;
}) {
  const color =
    tone === 'error' ? 'var(--color-mark-red)' : 'var(--color-mark-teal)';
  return (
    <p
      role={tone === 'error' ? 'alert' : 'status'}
      className="rounded-xl border border-line bg-carbon px-3 py-2 text-fluid-xs"
      style={{ color }}
    >
      {children}
    </p>
  );
}
