import { describe, expect, it } from "vitest";
import { fileMemoryIn, forgetScanZooms, REMEMBERED_SCAN_ZOOMS, rememberScanZoom, scanZoomKey, type FileViewMemory } from "./scanMemory";
import { INITIAL_SCAN_TABLE_OPTIONS } from "./scanTableView";
import { mzDomain, type MzDomain } from "./spectrumViewport";

const zoom = (scan: number) => mzDomain(scan, scan + 1);

describe("per-scan zoom memory", () => {
  it("keeps the 12th zoom, and the 13th pushes out the longest unused", () => {
    expect(REMEMBERED_SCAN_ZOOMS).toBe(12);
    const zooms = new Map<string, MzDomain>();
    for (let scan = 1; scan <= 12; scan += 1) rememberScanZoom(zooms, scanZoomKey("a", scan), zoom(scan));
    expect(zooms.size).toBe(12);
    expect(zooms.get(scanZoomKey("a", 1))).toEqual(zoom(1));
    rememberScanZoom(zooms, scanZoomKey("a", 13), zoom(13));
    expect(zooms.size).toBe(12);
    expect(zooms.has(scanZoomKey("a", 1))).toBe(false);
    expect(zooms.get(scanZoomKey("a", 2))).toEqual(zoom(2));
    expect(zooms.get(scanZoomKey("a", 13))).toEqual(zoom(13));
  });
  it("counts coming back to a scan as using it", () => {
    const zooms = new Map<string, MzDomain>();
    for (let scan = 1; scan <= 12; scan += 1) rememberScanZoom(zooms, scanZoomKey("a", scan), zoom(scan));
    rememberScanZoom(zooms, scanZoomKey("a", 1), zoom(1));
    rememberScanZoom(zooms, scanZoomKey("a", 13), zoom(13));
    expect(zooms.has(scanZoomKey("a", 1))).toBe(true);
    expect(zooms.has(scanZoomKey("a", 2))).toBe(false);
  });
  it("shares the list across files, and forgets only the file it is told to", () => {
    const zooms = new Map<string, MzDomain>();
    rememberScanZoom(zooms, scanZoomKey("a", 1), zoom(1));
    rememberScanZoom(zooms, scanZoomKey("a1", 1), zoom(2));
    rememberScanZoom(zooms, scanZoomKey("b", 1), zoom(3));
    expect(zooms.get(scanZoomKey("b", 1))).toEqual(zoom(3));
    forgetScanZooms(zooms, "a");
    expect([...zooms.keys()]).toEqual([scanZoomKey("a1", 1), scanZoomKey("b", 1)]);
  });
  it("keeps nothing for the whole spectrum, and a reset forgets the zoom", () => {
    const zooms = new Map<string, MzDomain>();
    rememberScanZoom(zooms, "k", null);
    expect(zooms.size).toBe(0);
    rememberScanZoom(zooms, "k", zoom(1));
    rememberScanZoom(zooms, "k", null);
    expect(zooms.size).toBe(0);
  });
});

describe("per-file memory", () => {
  it("starts a file clean and hands back the same entry", () => {
    const memory = new Map<string, FileViewMemory>();
    const file = fileMemoryIn(memory, "a");
    expect(file).toEqual({ options: INITIAL_SCAN_TABLE_OPTIONS, selected: null, topRow: null });
    expect(fileMemoryIn(memory, "a")).toBe(file);
    expect(fileMemoryIn(memory, "b")).not.toBe(file);
  });
});
