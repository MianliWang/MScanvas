import { useRef, type KeyboardEvent, type ReactNode } from "react";

import { cx, step, type AccessibleName } from "./shared";

export interface SegmentOption<T extends string> {
  readonly value: T;
  readonly label: ReactNode;
}

export type SegmentedControlProps<T extends string> = AccessibleName & {
  readonly value: T;
  readonly options: readonly SegmentOption<T>[];
  readonly onChange: (value: T) => void;
  /** Freezes the whole group: the options are native-disabled and leave the Tab order. */
  readonly disabled?: boolean;
  readonly className?: string;
};

/**
 * A single choice among a few options, as a radio group: one Tab stop (the
 * checked option), arrow keys move and choose, wrapping at the ends.
 */
export function SegmentedControl<T extends string>({
  label, labelledBy, value, options, onChange, disabled = false, className,
}: SegmentedControlProps<T>) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);
  const checked = Math.max(0, options.findIndex(option => option.value === value));

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const delta = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1
      : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (delta === 0) return;
    event.preventDefault();
    const to = step(index, delta, options.length);
    buttons.current[to]?.focus();
    onChange(options[to].value);
  };

  return <div role="radiogroup" aria-label={label} aria-labelledby={labelledBy}
    className={cx("ui-segmented", className)}>
    {options.map((option, index) => <button key={option.value} ref={element => { buttons.current[index] = element; }}
      type="button" role="radio" className="ui-segmented__option" aria-checked={option.value === value}
      tabIndex={index === checked ? 0 : -1} disabled={disabled}
      onClick={() => { if (option.value !== value) onChange(option.value); }}
      onKeyDown={event => onKeyDown(event, index)}>
      {option.label}
    </button>)}
  </div>;
}
