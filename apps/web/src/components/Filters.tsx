import { ROLES, type Role } from '@challenge/core/domain';
import { ROLE_LABEL, classNames } from './ui';
import { RoleIcon } from './icons';

export type SortKey = 'ladder' | 'gained' | 'winrate' | 'kda' | 'games';

export const SORT_OPTIONS: Array<{ key: SortKey; label: string }> = [
  { key: 'ladder', label: 'Rango' },
  { key: 'gained', label: 'LP gained' },
  { key: 'winrate', label: 'Winrate' },
  { key: 'kda', label: 'KDA' },
  { key: 'games', label: 'Partidas jugadas' },
];

export interface FilterState {
  role: Role | 'ALL';
  query: string;
  sort: SortKey;
  liveOnly: boolean;
}

interface FiltersProps {
  value: FilterState;
  onChange: (next: FilterState) => void;
  counts: Record<Role | 'ALL', number>;
  liveCount: number;
  resultCount: number;
}

export function Filters({
  value,
  onChange,
  counts,
  liveCount,
  resultCount,
}: FiltersProps) {
  const roleOptions: Array<Role | 'ALL'> = ['ALL', ...ROLES];

  return (
    <div className="mb-4 flex flex-col gap-3 xl:flex-row xl:items-center xl:justify-between">
      <div
        className="-mx-1 flex gap-1 overflow-x-auto px-1 py-1"
        role="group"
        aria-label="Filtrar por rol"
      >
        {roleOptions.map((role) => {
          const active = value.role === role;
          return (
            <button
              key={role}
              type="button"
              aria-pressed={active}
              onClick={() => onChange({ ...value, role })}
              className={classNames(
                'eyebrow inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 transition-all',
                active
                  ? 'border-transparent text-void'
                  : 'border-line bg-carbon text-ink-2 hover:border-line-strong hover:text-ink',
              )}
              style={
                active
                  ? {
                      background: 'var(--color-accent)',
                      boxShadow: '0 0 20px -6px var(--color-accent)',
                    }
                  : undefined
              }
            >
              {role !== 'ALL' && <RoleIcon role={role} size={15} />}
              {role === 'ALL' ? 'All' : ROLE_LABEL[role]}
              <span
                className={classNames(
                  'tabular text-[0.65rem]',
                  active ? 'opacity-70' : 'text-ink-3',
                )}
              >
                {counts[role] ?? 0}
              </span>
            </button>
          );
        })}

        <button
          type="button"
          aria-pressed={value.liveOnly}
          onClick={() => onChange({ ...value, liveOnly: !value.liveOnly })}
          className={classNames(
            'eyebrow inline-flex min-h-10 shrink-0 items-center gap-1.5 rounded-full border px-3.5 transition-all',
            value.liveOnly
              ? 'text-void'
              : 'border-line bg-carbon text-ink-2 hover:border-line-strong hover:text-ink',
          )}
          style={
            value.liveOnly
              ? {
                  background: 'var(--color-mark-teal)',
                  borderColor: 'transparent',
                  boxShadow: '0 0 20px -6px var(--color-mark-teal)',
                }
              : undefined
          }
        >
          <span
            className={classNames(
              'h-1.5 w-1.5 rounded-full',
              !value.liveOnly && 'live-dot',
            )}
            style={{
              background: value.liveOnly
                ? 'var(--color-void)'
                : 'var(--color-mark-teal)',
            }}
          />
          En partida
          <span
            className={classNames(
              'tabular text-[0.65rem]',
              value.liveOnly ? 'opacity-70' : 'text-ink-3',
            )}
          >
            {liveCount}
          </span>
        </button>
      </div>

      <div className="flex items-center gap-2">
        <label className="relative flex-1 xl:w-56 xl:flex-none">
          <span className="sr-only">Search player</span>
          <input
            type="search"
            value={value.query}
            placeholder="Buscar jugador…"
            onChange={(event) =>
              onChange({ ...value, query: event.target.value })
            }
            className="min-h-10 w-full rounded-full border border-line bg-carbon px-4 text-fluid-sm text-ink transition-colors placeholder:text-ink-3 focus:border-[color:var(--color-accent)]"
          />
        </label>

        <label>
          <span className="sr-only">Sort by</span>
          <select
            value={value.sort}
            onChange={(event) =>
              onChange({ ...value, sort: event.target.value as SortKey })
            }
            className="min-h-10 rounded-full border border-line bg-carbon px-4 text-fluid-sm text-ink"
          >
            {SORT_OPTIONS.map((option) => (
              <option key={option.key} value={option.key}>
                Sort: {option.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <p className="sr-only" role="status">
        {resultCount} players shown
      </p>
    </div>
  );
}
