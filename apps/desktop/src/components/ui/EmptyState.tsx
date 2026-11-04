import type { ReactNode } from "react";

import { cx } from "./shared";

export interface EmptyStateProps {
  /** One line saying what is missing. */
  readonly message: ReactNode;
  /** The one action that fills it: a `<Button variant="primary">`. */
  readonly action?: ReactNode;
  readonly className?: string;
}

export function EmptyState({ message, action, className }: EmptyStateProps) {
  return <div className={cx("ui-empty-state", className)}>
    <p className="ui-empty-state__message">{message}</p>
    {action}
  </div>;
}
