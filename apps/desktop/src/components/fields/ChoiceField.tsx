import { useId } from "react";

/** Native radios keep keyboard and form semantics inside the owned styling. */
export function ChoiceField<T extends string>({ labelledBy, describedBy, value, options, onChange }: {
  readonly labelledBy: string;
  readonly describedBy?: string;
  readonly value: T;
  readonly options: readonly { readonly value: T; readonly label: string }[];
  readonly onChange: (value: T) => void;
}) {
  const name = useId();
  return <div className="choice-field" role="radiogroup" aria-labelledby={labelledBy} aria-describedby={describedBy}>
    {options.map((option) => <label className="choice-field-option" key={option.value}>
      <input type="radio" name={name} value={option.value} checked={value === option.value}
        onChange={() => onChange(option.value)} />
      <span>{option.label}</span>
    </label>)}
  </div>;
}
