/** Stroke paths on a 24px grid, taken from the v5.11 reference's icon set. */
const PATHS = {
  wave: "M2 12h3l2-8 4 16 3-12 3 4h5",
  file: "M7 3h8l4 4v14H5V3h2 M14 3v5h5 M8 12h8 M8 16h6",
  folder: "M3 6h6l2 2h10v12H3z",
  table: "M3 4h18v16H3z M3 9h18 M3 14h18 M9 4v16",
  chart: "M4 3v17h17 M7 14l4-6 4 3 5-6",
  download: "M12 3v12m-5-5 5 5 5-5 M4 16v5h16v-5",
  search: "M10 3a7 7 0 1 0 0 14 7 7 0 1 0 0-14 M15 15l6 6",
  chevronRight: "m9 5 7 7-7 7",
  chevronDown: "m5 8 7 7 7-7",
  chevronUp: "m5 15 7-7 7 7",
  arrowRight: "M4 12h16m-6-6 6 6-6 6",
  arrowLeft: "M20 12H4m6-6-6 6 6 6",
  check: "m4 12 5 5 11-12",
  close: "m5 5 14 14M5 19 19 5",
  play: "m7 4 13 8-13 8z",
  plus: "M12 4v16M4 12h16",
  settings: "M4 6h16M4 12h16M4 18h16 M8 3v6 M16 9v6 M10 15v6",
  info: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18 M12 11v6 M12 7v1",
  layers: "m3 8 9-5 9 5-9 5z M3 12l9 5 9-5 M3 16l9 5 9-5",
  clock: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18 M12 7v5l4 2",
  eye: "M2 12s4-7 10-7 10 7 10 7-4 7-10 7S2 12 2 12 M12 9a3 3 0 1 0 0 6 3 3 0 1 0 0-6",
  note: "M5 3h14v18H5z M8 8h8 M8 12h8 M8 16h5",
  refresh: "M20 8A8 8 0 1 0 20 16 M20 3v5h-5",
  minus: "M5 12h14",
  copy: "M8 8h12v12H8z M16 8V4H4v12h4",
  more: "M5 12h.01 M12 12h.01 M19 12h.01",
  undo: "M9 14 4 9l5-5 M4 9h11a5 5 0 0 1 0 10h-3",
  panelLeft: "M3 4h18v16H3z M9 4v16",
  panelRight: "M3 4h18v16H3z M15 4v16",
  fit: "M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5",
  checkCircle: "M12 3a9 9 0 1 0 0 18 9 9 0 1 0 0-18 M8 12.5l2.7 2.7L16.5 9.5",
  alert: "M12 3.5 2.5 20h19z M12 9.5v5 M12 17.2v.3",
} as const;

export type IconName = keyof typeof PATHS;

/** A decorative glyph: the control that carries it owns the accessible name. */
export function Icon({ name, size = 16 }: { readonly name: IconName; readonly size?: number }) {
  return <svg className="ui-icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">
    {/* The ellipsis dots are near-zero strokes: they need the wider pen. */}
    <path d={PATHS[name]} strokeWidth={name === "more" ? 3 : undefined} />
  </svg>;
}
