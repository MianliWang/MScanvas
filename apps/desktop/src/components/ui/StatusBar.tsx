import type { ReactNode } from "react";

import { cx } from "./shared";

export interface StatusBarProps {
  /** Left slot (start edge). */
  readonly start?: ReactNode;
  /** Right slot (end edge). */
  readonly end?: ReactNode;
  readonly className?: string;
}

/**
 * The thin bar along the window's foot. Not a live region itself: wrap the
 * parts that change and must be announced in their own `role="status"`.
 */
export function StatusBar({ start, end, className }: StatusBarProps) {
  return <div className={cx("ui-status-bar", className)}>
    <div className="ui-status-bar__start">{start}</div>
    <div className="ui-status-bar__end">{end}</div>
  </div>;
}
