import type { ReactNode } from "react";

import { Button, type ButtonProps } from "./Button";
import { cx } from "./shared";

export interface IconButtonProps extends Omit<ButtonProps, "children" | "icon" | "aria-label"> {
  /** The accessible name, also shown as the tooltip unless `title` overrides it. */
  readonly label: string;
  readonly icon: ReactNode;
}

/** A square button whose only visible content is an icon. Defaults to `quiet`. */
export function IconButton({ label, icon, variant = "quiet", title, className, ...rest }: IconButtonProps) {
  return <Button {...rest} variant={variant} aria-label={label} title={title ?? label}
    className={cx("ui-icon-button", className)}>{icon}</Button>;
}
