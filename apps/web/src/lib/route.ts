import { useMemo, useSyncExternalStore } from 'react';

/**
 * The dashboard is one island holding one snapshot, so its sections cannot be
 * separate Astro pages without refetching everything on every click. Instead the
 * query string is the source of truth and the view is derived from it: a refresh
 * lands on the same section, the back button walks the sections you visited, and
 * a link to an open player card actually opens that card.
 */
export interface Route {
  /** Dashboard section. */
  tab: string | null;
  /** Player whose detail modal is open. */
  player: string | null;
  /** Tab inside that player's modal. */
  view: string | null;
}

const KEYS: Record<keyof Route, string> = {
  tab: 'tab',
  player: 'player',
  view: 'view',
};

const listeners = new Set<() => void>();

/**
 * The snapshot has to be referentially stable between reads, so we hand out the
 * raw query string and let callers parse it in a memo.
 */
function readSearch(): string {
  return window.location.search;
}

function subscribe(onChange: () => void): () => void {
  listeners.add(onChange);
  // popstate covers the back and forward buttons; our own writes are announced
  // through the listener set, because pushState does not fire an event.
  window.addEventListener('popstate', onChange);
  return () => {
    listeners.delete(onChange);
    window.removeEventListener('popstate', onChange);
  };
}

function parse(search: string): Route {
  const params = new URLSearchParams(search);
  return {
    tab: params.get(KEYS.tab),
    player: params.get(KEYS.player),
    view: params.get(KEYS.view),
  };
}

/** Reads the current route and re-renders whenever it changes. */
export function useRoute(): Route {
  // On the server there is no URL to read, so everything defaults and the first
  // client render corrects it.
  const search = useSyncExternalStore(subscribe, readSearch, () => '');
  return useMemo(() => parse(search), [search]);
}

/**
 * Merges a patch into the query string. Keys set to null are removed, so
 * `{ player: null }` is how a modal closes.
 *
 * `push` adds a history entry (back returns to the previous view); `replace`
 * rewrites the current one, for changes that should not become a stop on the way
 * back — like switching tabs inside an open card.
 */
export function navigate(
  patch: Partial<Route>,
  mode: 'push' | 'replace' = 'push',
): void {
  const params = new URLSearchParams(window.location.search);

  for (const [name, value] of Object.entries(patch) as Array<
    [keyof Route, string | null | undefined]
  >) {
    if (value) params.set(KEYS[name], value);
    else params.delete(KEYS[name]);
  }

  const query = params.toString();
  const url = `${window.location.pathname}${query ? `?${query}` : ''}`;

  if (mode === 'push' && url === `${window.location.pathname}${window.location.search}`) {
    // Nothing moved: pushing here would stack duplicate entries and make the
    // back button feel stuck.
    return;
  }

  window.history[mode === 'push' ? 'pushState' : 'replaceState'](null, '', url);
  for (const listener of listeners) listener();
}

/** Keeps a value inside a known set, falling back when the URL says nonsense. */
export function oneOf<T extends string>(
  value: string | null,
  allowed: ReadonlyArray<T>,
  fallback: T,
): T {
  return allowed.includes(value as T) ? (value as T) : fallback;
}
