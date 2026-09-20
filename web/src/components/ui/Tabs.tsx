import { useRef, type KeyboardEvent, type ReactNode } from 'react';
import { cn } from '@/lib/cn';

export interface TabItem<T extends string> {
  id: T;
  label: ReactNode;
}

interface TabsProps<T extends string> {
  /** Accessible name of the tab list. */
  label: string;
  tabs: Array<TabItem<T>>;
  value: T;
  onChange: (id: T) => void;
  /** Unique prefix so ids of tabs and their panels can reference each other. */
  idPrefix: string;
  /** `prominent` = the page's primary switch: taller, larger text, solid selected tab. */
  variant?: 'default' | 'prominent';
}

export const tabId = (prefix: string, id: string) => `${prefix}-tab-${id}`;
export const panelId = (prefix: string, id: string) => `${prefix}-panel-${id}`;

/**
 * Segmented control with proper tab semantics: arrow keys / Home / End move between tabs,
 * only the selected tab is in the tab order, and each tab points at its panel.
 */
export function Tabs<T extends string>({ label, tabs, value, onChange, idPrefix, variant = 'default' }: TabsProps<T>) {
  const prominent = variant === 'prominent';
  const refs = useRef(new Map<T, HTMLButtonElement>());

  const onKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    const index = tabs.findIndex((t) => t.id === value);
    let next = -1;
    if (event.key === 'ArrowRight') next = (index + 1) % tabs.length;
    else if (event.key === 'ArrowLeft') next = (index - 1 + tabs.length) % tabs.length;
    else if (event.key === 'Home') next = 0;
    else if (event.key === 'End') next = tabs.length - 1;
    if (next < 0) return;
    event.preventDefault();
    const target = tabs[next];
    if (!target) return;
    onChange(target.id);
    refs.current.get(target.id)?.focus();
  };

  return (
    <div role="tablist" aria-label={label} onKeyDown={onKeyDown} className={cn('flex overflow-x-auto rounded-2xl bg-surface-2', prominent ? 'gap-1.5 border border-border p-1.5 shadow-sm' : 'gap-1 p-1')}>
      {tabs.map((tab) => {
        const selected = tab.id === value;
        return (
          <button
            key={tab.id}
            ref={(el) => {
              if (el) refs.current.set(tab.id, el);
              else refs.current.delete(tab.id);
            }}
            type="button"
            role="tab"
            id={tabId(idPrefix, tab.id)}
            aria-selected={selected}
            aria-controls={panelId(idPrefix, tab.id)}
            tabIndex={selected ? 0 : -1}
            onClick={() => onChange(tab.id)}
            className={cn(
              'min-w-fit flex-1 whitespace-nowrap rounded-xl px-3 font-semibold transition-colors',
              prominent ? 'flex min-h-12 items-center justify-center gap-2 text-base font-bold' : 'min-h-11 text-sm',
              selected ? (prominent ? 'bg-primary text-primary-fg shadow' : 'bg-surface text-primary shadow-sm') : 'text-muted',
            )}
          >
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/** `hidden` keeps the panel mounted (so its state survives switching tabs) but invisible. */
export function TabPanel({ idPrefix, id, hidden = false, flush = false, children }: { idPrefix: string; id: string; hidden?: boolean; flush?: boolean; children: ReactNode }) {
  return (
    <div role="tabpanel" id={panelId(idPrefix, id)} aria-labelledby={tabId(idPrefix, id)} tabIndex={hidden ? -1 : 0} hidden={hidden} className={cn(flush ? '' : 'mt-4', 'outline-offset-4')}>
      {children}
    </div>
  );
}
