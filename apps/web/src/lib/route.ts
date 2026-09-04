import { useMemo, useSyncExternalStore } from 'react';

/**
 * The dashboard is one island holding one snapshot, not a client-routed SPA —
 * so a hard load rebuilds it from scratch and any state living only in React is
 * gone. That is why the URL is the source of truth here and the view is derived
 * from it: a refresh lands on the same section, back and forward walk the
 * sections, and a link to an open player card reopens that card.
 *
 * Sections are real paths (`/shells`), each prerendered to the same island, so
 * moving between them is a pushState with no reload and no refetch. The open
 * card stays a query parameter on purpose: a path would have to be prerendered
 * per player, and the build cannot even reach the backend to enumerate them.
 */
export interface Route {
  /** First path segment — the dashboard section, or null at the root. */
  tab: string | null;
  /** Player whose detail modal is open. */
  player: string | null;
  /** Tab inside that player's modal. */
  view: string | null;
}

const KEYS = {
  player: 'player',
  view: 'view',
} as const;

const listeners = new Set<() => void>();

/**
 * Prefix every section path sits under. Empty for the production dashboard,
 * which owns the root; `/demo` for the alternate design, which mounts the same
 * island one level down. Set once before the island renders, so `useRoute` and
 * `navigate` agree on which segment is the section and which is the mount
 * point.
 */
let basePath = '';

/** Normalises `demo`, `/demo` and `/demo/` to the same `/demo`. */
export function setBasePath(value: string): void {
  const trimmed = value.replace(/^\/+|\/+$/g, '');
  basePath = trimmed ? `/${trimmed}` : '';
}

/** Strips the mount point, leaving the path the router reasons about. */
function relative(path: string): string {
  if (!basePath) return path;
  if (path === basePath) return '/';
  return path.startsWith(`${basePath}/`) ? path.slice(basePath.length) : path;
}

/**
 * The snapshot has to be referentially stable between reads, so we hand out the
 * raw location and let callers parse it in a memo.
 */
function readLocation(): string {
  return window.location.pathname + window.location.search;
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

function parse(location: string): Route {
  const [rawPath = '', search = ''] = location.split('?');
  const path = relative(rawPath);
  const params = new URLSearchParams(search);

  return {
    // Only the first segment matters, and a trailing slash is not a section.
    tab: path.split('/').filter(Boolean)[0] ?? null,
    player: params.get(KEYS.player),
    view: params.get(KEYS.view),
  };
}

/** Reads the current route and re-renders whenever it changes. */
export function useRoute(): Route {
  // On the server there is no URL to read, so everything defaults and the first
  // client render corrects it.
  const location = useSyncExternalStore(subscribe, readLocation, () => '/');
  return useMemo(() => parse(location), [location]);
}

/**
 * Merges a patch into the URL. `tab` becomes the path (null is the root); the
 * rest become query parameters, and a null removes one — `{ player: null }` is
 * how a modal closes.
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

  for (const name of ['player', 'view'] as const) {
    if (!(name in patch)) continue;
    const value = patch[name];
    if (value) params.set(KEYS[name], value);
    else params.delete(KEYS[name]);
  }

  const path =
    'tab' in patch
      ? patch.tab
        ? `${basePath}/${patch.tab}`
        : basePath || '/'
      : window.location.pathname;

  const query = params.toString();
  const url = `${path}${query ? `?${query}` : ''}`;

  if (mode === 'push' && url === readLocation()) {
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
