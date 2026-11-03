import { useCallback, useEffect, useRef, useState } from "react";

import { toPreviewError, type PreviewError } from "../mzml-preview/contracts";
import { useRunHistoryApi, type RunListOutcome, type RunWriteOutcome } from "./runHistoryApi";

export interface RunList {
  readonly reading: boolean;
  /** The latest answer, kept on screen while the next one is read. */
  readonly answer: RunListOutcome | null;
  /** Why the latest read did not answer, if it did not. */
  readonly error: PreviewError | null;
  /** Counts the answers, so a reader of one run can follow the list. */
  readonly revision: number;
  readonly reload: () => void;
}

/** Says a Clear or an Off happened, so every open list reads again: Off forgets what they show. */
const written = new EventTarget();

/** The stored runs, read when this mounts, on `reload` and after a write. The latest read wins. */
export function useRunList(): RunList {
  const api = useRunHistoryApi();
  const [state, setState] = useState<Omit<RunList, "reload">>({ reading: true, answer: null, error: null, revision: 0 });
  const latest = useRef(0);
  const reload = useCallback(() => {
    latest.current += 1;
    const request = latest.current;
    setState((held) => ({ ...held, reading: true }));
    void api.listRuns().then(
      (answer) => {
        if (request === latest.current) setState((held) => ({ reading: false, answer, error: null, revision: held.revision + 1 }));
      },
      (cause: unknown) => {
        if (request === latest.current) setState((held) => ({ ...held, reading: false, error: toPreviewError(cause) }));
      },
    );
  }, [api]);
  useEffect(() => {
    reload();
    written.addEventListener("written", reload);
    return () => {
      latest.current += 1;
      written.removeEventListener("written", reload);
    };
  }, [reload]);
  return { ...state, reload };
}

/** What a Clear or an Off answered, or the refusal of the request itself. */
export type RunWriteAnswer = RunWriteOutcome | { readonly outcome: "error"; readonly error: PreviewError };

/** A write that did not plainly succeed, answered after its view had gone: the next view of that kind says it. */
const unreported = new Map<"clear" | "off", RunWriteAnswer>();

/** One write at a time. Every open list is read again whatever it answered. */
export function useRunWrite(kind: "clear" | "off") {
  const [writing, setWriting] = useState(false);
  const [answer, setAnswer] = useState<RunWriteAnswer | null>(() => unreported.get(kind) ?? null);
  const claimed = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    unreported.delete(kind);
    return () => { mounted.current = false; };
  }, [kind]);
  const write = (operation: () => Promise<RunWriteOutcome>) => {
    if (claimed.current) return;
    claimed.current = true;
    setWriting(true);
    setAnswer(null);
    void operation()
      .catch((cause: unknown): RunWriteAnswer => ({ outcome: "error", error: toPreviewError(cause) }))
      .then((settled) => {
        claimed.current = false;
        if (mounted.current) {
          setWriting(false);
          setAnswer(settled);
        } else if (settled.outcome !== "done") {
          unreported.set(kind, settled);
        }
        written.dispatchEvent(new Event("written"));
      });
  };
  return { writing, answer, write };
}
