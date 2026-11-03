import { useCallback, useEffect, useRef, useState, type RefObject } from "react";

import type { PreviewApi } from "./api";
import { toPreviewError, type PreviewError, type RawViewAvailability, type RawViewState } from "./contracts";

/**
 * How often a running view is read (ADR 0060 decision 12: polled, no event
 * channel). Faster than the queue's two seconds, because this pane shows bars of
 * bytes MSCanvas is reading and an elapsed time.
 */
export const RAW_VIEW_POLL_MS = 400;

/** The state of the one-click view, as Rust last answered it. */
export interface RawViewControl {
  readonly state: RawViewState;
  /** The highlighted row's answer, or `null` until one is read or when no row is named. */
  readonly availability: RawViewAvailability | null;
  /** A press Rust refused because the state changed after the last read. */
  readonly refusal: { readonly handle: string; readonly error: PreviewError } | null;
  /** A view holds the conversion slot, or a press has not been answered yet. */
  readonly busy: boolean;
  /** The same fact, for a guard that runs outside a render. */
  readonly busyRef: RefObject<boolean>;
  readonly begin: (handle: string) => void;
  readonly cancel: () => void;
  /** Reads the state and the row's availability again, after something it depends on moved. */
  readonly refresh: () => void;
}

/**
 * Owns the view's polling. Rust owns the operation: this holds its last answer,
 * and a document that reloads reads the state and carries on.
 *
 * `onReady` hears an operation become ready while this document watched it run,
 * and no other way: a reload that finds one ready opens nothing, because the
 * row's pane offers Open for it.
 */
export function useRawView(api: PreviewApi, highlighted: string | null, onReady: (operation: number, handle: string) => void): RawViewControl {
  const [state, setState] = useState<RawViewState>({ state: "idle" });
  const [availability, setAvailability] = useState<RawViewAvailability | null>(null);
  const [refusal, setRefusal] = useState<RawViewControl["refusal"]>(null);
  const [claimed, setClaimed] = useState(false);
  /** Moves after every read, so a read that failed still arms the next one. */
  const [readCount, setReadCount] = useState(0);
  const stateRef = useRef(state);
  const busyRef = useRef(false);
  const highlightedRef = useRef(highlighted);
  highlightedRef.current = highlighted;
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;
  const mounted = useRef(true);
  /** Only the newest read speaks, so a slow answer cannot put back an older phase. */
  const reads = useRef(0);

  const apply = useCallback((next: RawViewState) => {
    const was = stateRef.current;
    stateRef.current = next;
    setState(next);
    busyRef.current = next.state === "running";
    if (next.state === "running") setRefusal(null);
    if (was.state === "running" && next.state === "ready" && was.operation === next.operation && next.openable) {
      onReadyRef.current(next.operation, next.handle);
    }
  }, []);

  const read = useCallback(() => {
    reads.current += 1;
    const ticket = reads.current;
    const handle = highlightedRef.current;
    void api.getRawViewState(handle).then((snapshot) => {
      if (!mounted.current || ticket !== reads.current) return;
      apply(snapshot.state);
      setAvailability(handle === highlightedRef.current ? snapshot.availability : null);
    }).catch(() => {
      // Nothing is known about the row, so View stays refused until a read answers.
      if (mounted.current && ticket === reads.current) setAvailability(null);
    }).finally(() => {
      if (mounted.current && ticket === reads.current) setReadCount((count) => count + 1);
    });
  }, [api, apply]);

  useEffect(() => {
    mounted.current = true;
    return () => { mounted.current = false; };
  }, []);

  // On mount, so a reloaded document resumes, and whenever the row changes.
  useEffect(() => {
    setAvailability(null);
    read();
  }, [highlighted, read]);

  const running = state.state === "running";
  useEffect(() => {
    if (!running) return;
    const timer = setTimeout(read, RAW_VIEW_POLL_MS);
    return () => { clearTimeout(timer); };
  }, [read, readCount, running]);

  const begin = useCallback((handle: string) => {
    if (busyRef.current) return;
    // Raised before the answer, so no second press and no other route slips in.
    busyRef.current = true;
    setClaimed(true);
    setRefusal(null);
    reads.current += 1;
    void api.beginRawView(handle).then(apply).catch((cause: unknown) => {
      busyRef.current = false;
      if (mounted.current) setRefusal({ handle, error: toPreviewError(cause) });
    }).finally(() => {
      if (!mounted.current) return;
      setClaimed(false);
      read();
    });
  }, [api, apply, read]);

  const cancel = useCallback(() => {
    const current = stateRef.current;
    if (current.state !== "running") return;
    reads.current += 1;
    void api.cancelRawView(current.operation).then(apply).catch(() => undefined).finally(() => {
      if (mounted.current) read();
    });
  }, [api, apply, read]);

  return { state, availability, refusal, busy: running || claimed, busyRef, begin, cancel, refresh: read };
}
