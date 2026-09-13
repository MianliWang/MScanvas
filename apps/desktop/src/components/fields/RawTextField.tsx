import { useRef } from "react";

/** Preserve the editing string and node; parsing remains with the domain owner. */
export function RawTextField({ id, labelledBy, describedBy, invalid, value, onChange }: {
  readonly id: string;
  readonly labelledBy: string;
  readonly describedBy?: string;
  readonly invalid: boolean;
  readonly value: string;
  readonly onChange: (value: string) => void;
}) {
  const composing = useRef(false);
  return <input id={id} className="spectrum-figure-input" type="text" inputMode="numeric"
    aria-labelledby={labelledBy} aria-describedby={describedBy} aria-invalid={invalid || undefined}
    value={value} onChange={(event) => onChange(event.target.value)}
    onCompositionStart={() => { composing.current = true; }}
    onCompositionEnd={() => { composing.current = false; }}
    onKeyDown={(event) => {
      if ((composing.current || event.nativeEvent.isComposing || event.keyCode === 229) &&
        (event.key === "Enter" || event.key === "Escape")) event.stopPropagation();
    }} />;
}
