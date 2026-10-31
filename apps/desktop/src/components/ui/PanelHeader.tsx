import type { ReactNode } from "react";

import { cx } from "./shared";

export interface PanelHeaderProps {
  readonly title: ReactNode;
  /** Id on the heading, for the panel's `aria-labelledby`. */
  readonly titleId?: string;
  readonly level?: 2 | 3 | 4;
  /** The panel's own actions, right-aligned on the title's row. */
  readonly actions?: ReactNode;
  readonly className?: string;
}

/** A panel's title row. A `div`, not `header`, so it never becomes a banner landmark. */
export function PanelHeader({ title, titleId, level = 2, actions, className }: PanelHeaderProps) {
  const Heading = `h${level}` as const;
  return <div className={cx("ui-panel-header", className)}>
    <Heading id={titleId} className="ui-panel-header__title">{title}</Heading>
    {actions ? <div className="ui-panel-header__actions">{actions}</div> : null}
  </div>;
}
