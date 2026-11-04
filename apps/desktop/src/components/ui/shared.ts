/** Joins class names, skipping empty ones. */
export function cx(...names: (string | false | null | undefined)[]): string {
  return names.filter(Boolean).join(" ");
}

/** A composite widget's accessible name: visible text by id, or a localized label. */
export type AccessibleName =
  | { readonly label: string; readonly labelledBy?: undefined }
  | { readonly labelledBy: string; readonly label?: undefined };

/** The next index in a wrapping list, for arrow-key navigation. */
export function step(index: number, delta: number, length: number): number {
  return (index + delta + length) % length;
}
