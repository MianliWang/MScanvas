import { useId, useState, type ComponentPropsWithoutRef, type ReactNode } from "react";

import { Button, type ButtonProps } from "./Button";
import { Icon } from "./Icon";

export interface DisclosureProps
  extends Omit<ButtonProps, "children" | "icon" | "onClick" | "aria-expanded" | "aria-controls"> {
  /** The button's visible text. */
  readonly label: ReactNode;
  /** The region's content. It stays mounted while closed, only `hidden`. */
  readonly children: ReactNode;
  /** Controlled open state; pair it with `onOpenChange`. */
  readonly open?: boolean;
  readonly defaultOpen?: boolean;
  readonly onOpenChange?: (open: boolean) => void;
  /** Props for the region `div`; its `id` defaults to a generated one. */
  readonly regionProps?: Omit<ComponentPropsWithoutRef<"div">, "hidden" | "children">
    & { readonly [data: `data-${string}`]: string | undefined };
}

/**
 * A button that shows and hides the region after it (rebuild spec 1.5 rule 3):
 * a chevron, `aria-expanded` and `aria-controls`. Defaults to a quiet sm button.
 */
export function Disclosure({
  label, children, open, defaultOpen = false, onOpenChange, regionProps,
  variant = "quiet", size = "sm", ...rest
}: DisclosureProps) {
  const [ownOpen, setOwnOpen] = useState(defaultOpen);
  const generatedId = useId();
  const isOpen = open ?? ownOpen;
  const regionId = regionProps?.id ?? generatedId;
  const toggle = () => {
    setOwnOpen(!isOpen);
    onOpenChange?.(!isOpen);
  };
  return <>
    <Button {...rest} variant={variant} size={size} aria-expanded={isOpen} aria-controls={regionId}
      icon={<Icon name={isOpen ? "chevronDown" : "chevronRight"} />} onClick={toggle}>{label}</Button>
    <div {...regionProps} id={regionId} hidden={!isOpen}>{children}</div>
  </>;
}
