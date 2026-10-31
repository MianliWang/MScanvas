import { Fragment, useId, useRef, type KeyboardEvent, type ReactNode } from "react";

import { cx, step, type AccessibleName } from "./shared";

export interface TabItem<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
}

export type TabsProps<T extends string> = AccessibleName & {
  readonly value: T;
  readonly items: readonly TabItem<T>[];
  readonly onChange: (value: T) => void;
  /** The selected tab's content. Only that panel is mounted; keep state that must survive a switch above `Tabs`. */
  readonly children: ReactNode;
  readonly className?: string;
};

/**
 * WAI-ARIA tabs, controlled, with automatic activation: arrow keys (wrapping)
 * and Home/End move focus and select. The selected tab is the one Tab stop in
 * the tablist; the panel is the next.
 */
export function Tabs<T extends string>({ label, labelledBy, value, items, onChange, children, className }: TabsProps<T>) {
  const base = useId();
  const tabs = useRef<(HTMLButtonElement | null)[]>([]);
  const selected = Math.max(0, items.findIndex(item => item.value === value));
  const panelId = `${base}panel`;

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const to = event.key === "ArrowRight" ? step(index, 1, items.length)
      : event.key === "ArrowLeft" ? step(index, -1, items.length)
        : event.key === "Home" ? 0
          : event.key === "End" ? items.length - 1
            : -1;
    if (to < 0) return;
    event.preventDefault();
    tabs.current[to]?.focus();
    if (items[to].value !== value) onChange(items[to].value);
  };

  return <div className={cx("ui-tabs", className)}>
    <div role="tablist" aria-label={label} aria-labelledby={labelledBy} className="ui-tablist">
      {items.map((item, index) => <button key={item.value} ref={element => { tabs.current[index] = element; }}
        id={`${base}tab${index}`} type="button" role="tab" className="ui-tab"
        aria-selected={index === selected} aria-controls={index === selected ? panelId : undefined}
        tabIndex={index === selected ? 0 : -1}
        onClick={() => { if (item.value !== value) onChange(item.value); }}
        onKeyDown={event => onKeyDown(event, index)}>
        {item.label}
      </button>)}
    </div>
    <div role="tabpanel" id={panelId} aria-labelledby={`${base}tab${selected}`} tabIndex={0} className="ui-tabpanel">
      <Fragment key={value}>{children}</Fragment>
    </div>
  </div>;
}
