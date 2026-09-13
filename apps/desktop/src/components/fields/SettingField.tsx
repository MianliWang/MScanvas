import type { ReactNode } from "react";

/** Shared label/help hierarchy; callers own values, validation and callbacks. */
export function SettingField({ labelId, label, htmlFor, help, children, className = "" }: {
  readonly labelId: string;
  readonly label: string;
  readonly htmlFor?: string;
  readonly help?: string;
  readonly children: ReactNode;
  readonly className?: string;
}) {
  return <div className={`setting-field ${className}`}>
    <div className="setting-field-copy">
      {htmlFor === undefined
        ? <span id={labelId} className="setting-field-label">{label}</span>
        : <label id={labelId} htmlFor={htmlFor} className="setting-field-label">{label}</label>}
      {help === undefined ? null : <span id={`${labelId}-help`} className="setting-field-help">{help}</span>}
    </div>
    <div className="setting-field-control">{children}</div>
  </div>;
}
