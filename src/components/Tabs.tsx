import { useRef, type KeyboardEvent } from 'react';
import { classNames } from './ui';

export interface TabDefinition<T extends string> {
  id: T;
  label: string;
  /** Optional count rendered beside the label, e.g. number of players. */
  badge?: string;
}

interface TabsProps<T extends string> {
  tabs: ReadonlyArray<TabDefinition<T>>;
  active: T;
  onChange: (id: T) => void;
  label: string;
  size?: 'lg' | 'sm';
}

/**
 * A real tablist: arrow keys move between tabs, Home and End jump to the ends,
 * and the selected tab is announced. The pill slides visually but focus follows
 * selection, which is the pattern keyboard users expect from a manual tablist.
 */
export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  label,
  size = 'lg',
}: TabsProps<T>) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = tabs.findIndex((tab) => tab.id === active);
    if (currentIndex < 0) return;

    const moves: Record<string, number> = {
      ArrowRight: 1,
      ArrowLeft: -1,
    };

    let nextIndex: number | null = null;
    if (event.key in moves) {
      nextIndex =
        (currentIndex + moves[event.key]! + tabs.length) % tabs.length;
    } else if (event.key === 'Home') {
      nextIndex = 0;
    } else if (event.key === 'End') {
      nextIndex = tabs.length - 1;
    }

    if (nextIndex === null) return;
    event.preventDefault();
    onChange(tabs[nextIndex]!.id);
    refs.current[nextIndex]?.focus();
  };

  return (
    <div
      role="tablist"
      aria-label={label}
      onKeyDown={handleKeyDown}
      className={classNames(
        'inline-flex max-w-full items-center gap-1 overflow-x-auto rounded-full border border-line bg-carbon/80 backdrop-blur',
        size === 'lg' ? 'p-1.5' : 'p-1',
      )}
    >
      {tabs.map((tab, index) => {
        const selected = tab.id === active;
        return (
          <button
            key={tab.id}
            ref={(node) => {
              refs.current[index] = node;
            }}
            role="tab"
            id={`tab-${tab.id}`}
            aria-selected={selected}
            aria-controls={`panel-${tab.id}`}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={classNames(
              'eyebrow relative shrink-0 rounded-full whitespace-nowrap transition-all duration-200',
              size === 'lg' ? 'px-4 py-2.5' : 'px-3 py-1.5 text-[0.62rem]',
              selected
                ? 'text-void'
                : 'text-ink-2 hover:bg-carbon-2 hover:text-ink',
            )}
            style={
              selected
                ? {
                    background: 'var(--color-accent)',
                    boxShadow:
                      '0 0 22px -4px var(--color-accent), inset 0 1px 0 0 rgba(255,255,255,0.25)',
                  }
                : undefined
            }
          >
            {tab.label}
            {tab.badge && (
              <span
                className={classNames(
                  'tabular ml-1.5 text-[0.65rem]',
                  selected ? 'opacity-70' : 'text-ink-3',
                )}
              >
                {tab.badge}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: React.ReactNode;
}) {
  if (!active) return null;
  return (
    <div
      role="tabpanel"
      id={`panel-${id}`}
      aria-labelledby={`tab-${id}`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
