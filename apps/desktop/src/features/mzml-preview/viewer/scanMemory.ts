/**
 * What a file and its scans keep while the workspace lives (VW-51, VW-35).
 *
 * Session state only: no record and no preference field, so a restart starts
 * clean. A file's chromatogram range is not kept: the reducer drops it with the
 * preview, and the list "page" is therefore a row rather than a scroll offset,
 * which would land elsewhere in a list no longer narrowed by that range.
 */

import { INITIAL_SCAN_TABLE_OPTIONS, type ScanTableOptions } from "./scanTableView";
import type { MzDomain } from "./spectrumViewport";

export interface FileViewMemory {
  options: ScanTableOptions;
  /** The identifier too, so a re-read that renumbered the file restores nothing. */
  selected: { readonly index: number; readonly identifier: string } | null;
  /** The source index of the list's top row: v5.11's page, in a list with no pages. */
  topRow: number | null;
}

/** Where a file's list was left: its top row, and the selection coming back with it. */
export interface ScanPage {
  readonly topRow: number;
  readonly selectedIndex: number | null;
}

export function fileMemoryIn(memory: Map<string, FileViewMemory>, handle: string): FileViewMemory {
  let file = memory.get(handle);
  if (file === undefined) {
    file = { options: INITIAL_SCAN_TABLE_OPTIONS, selected: null, topRow: null };
    memory.set(handle, file);
  }
  return file;
}

/** One list across the whole workspace, as v5.11 keeps it; the longest unused zoom goes first. */
export const REMEMBERED_SCAN_ZOOMS = 12;

export function scanZoomKey(handle: string, index: number): string {
  return `${handle}\n${index}`;
}

/** Keeps a scan's zoom as its most recent; the whole spectrum (`null`) is no zoom to keep. */
export function rememberScanZoom(zooms: Map<string, MzDomain>, key: string, zoom: MzDomain | null): void {
  zooms.delete(key);
  if (zoom === null) return;
  zooms.set(key, zoom);
  if (zooms.size > REMEMBERED_SCAN_ZOOMS) zooms.delete(zooms.keys().next().value as string);
}

export function forgetScanZooms(zooms: Map<string, MzDomain>, handle: string): void {
  for (const key of zooms.keys()) if (key.startsWith(`${handle}\n`)) zooms.delete(key);
}
