import type { ComponentPropsWithRef, MouseEvent, ReactNode } from "react";

import { cx } from "./shared";

export type ButtonVariant = "primary" | "secondary" | "quiet" | "danger";
export type ButtonSize = "sm" | "md";

/** `aria-disabled` is not a prop: a refused action is `refused` (+ `reasonId`), so it gets the guard and the styling. */
export interface ButtonProps extends Omit<ComponentPropsWithRef<"button">, "aria-disabled"> {
  readonly variant?: ButtonVariant;
  readonly size?: ButtonSize;
  /** Leading icon, drawn before the label. Decorative: give it `aria-hidden`. */
  readonly icon?: ReactNode;
  /**
   * A refused action stays a Tab stop (DESIGN_SYSTEM UI-24, PM9.7 F1): it is
   * `aria-disabled`, never native `disabled`, and a click (pointer, Enter or
   * Space) does nothing.
   */
  readonly refused?: boolean;
  /** Id of the visible element that says why the action is refused. */
  readonly reasonId?: string;
}

export function Button({
  variant = "secondary",
  size = "md",
  icon,
  refused = false,
  reasonId,
  type = "button",
  className,
  onClick,
  children,
  "aria-describedby": describedBy,
  ...rest
}: ButtonProps) {
  const describedByIds = cx(describedBy, refused && reasonId) || undefined;
  const handleClick = refused
    ? (event: MouseEvent<HTMLButtonElement>) => event.preventDefault()
    : onClick;
  return <button {...rest} type={type}
    className={cx("ui-button", `ui-button--${variant}`, `ui-button--${size}`, className)}
    aria-disabled={refused || undefined} aria-describedby={describedByIds} onClick={handleClick}>
    {icon}{children}
  </button>;
}
