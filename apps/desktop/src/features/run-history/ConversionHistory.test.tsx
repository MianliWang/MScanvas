import { act, cleanup, fireEvent, render, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it } from "vitest";

import { ownedErrorMessage } from "../mzml-preview/ownedErrorMessages";
import { UI_RESOURCES, bindUiMessages, createUiRuntime } from "../preferences/i18n";
import { SessionPreferencesProvider } from "../preferences/SessionPreferencesProvider";
import { ConversionHistory } from "./ConversionHistory";
import { RunHistorySetting } from "./RunHistorySetting";
import { RunHistoryApiProvider, type RunHistoryApi, type RunItem, type RunListOutcome, type RunReadOutcome, type RunSummary } from "./runHistoryApi";
import { completenessSentence, explainRunHistoryError, explainRunHistoryProblem } from "./runHistoryMessages";

const RUN: RunSummary = {
  runId: "a".repeat(32), state: "completed", startedAtMs: 1_793_955_600_000, endedAtMs: 1_793_959_200_000, interruptedAtMs: null,
  passes: 1, settingsRow: null, settingsVerified: true, buildRelease: "3.0.25000", buildVerified: true, failure: null,
  itemCount: 1, finalizedCount: 0, failedCount: 1, itemsOmitted: false,
};
const listed = (runs: readonly RunSummary[]): RunListOutcome => ({ outcome: "listed", recording: true, problem: null, runs, unreadable: 0, newer: 0 });
const failedItem = (progress: Partial<RunItem["progress"]>): RunItem => ({
  family: "thermo_raw", displayName: "a.raw", settingsVerified: true, buildVerified: true,
  progress: { state: "failed", attempts: 1, outcome: null, failure: null, outputs: [], completeness: null, setAdoptable: null, ...progress },
});
const FINALIZED = { fileName: "a-1.mzML", state: "finalized", byteLength: 1, sha256: "b".repeat(64), checks: null };

function api(overrides: Partial<RunHistoryApi>): RunHistoryApi {
  return {
    listRuns: () => Promise.resolve(listed([])),
    readRun: () => Promise.resolve({ outcome: "notFound" }),
    clearRuns: () => Promise.resolve({ outcome: "done", keptInProgress: 0 }),
    setEnabled: () => Promise.resolve({ outcome: "done", keptInProgress: 0 }),
    ...overrides,
  };
}

const withApi = (value: RunHistoryApi, ui: ReactNode) => render(
  <SessionPreferencesProvider><RunHistoryApiProvider value={value}>{ui}</RunHistoryApiProvider></SessionPreferencesProvider>,
);
const history = <ConversionHistory catalog={[]} queueState="idle" onClose={() => undefined} />;

/** The sentence one recorded item shows, by the same route the row takes. */
async function failureOf(item: RunItem): Promise<string | null | undefined> {
  const read: RunReadOutcome = { outcome: "found", run: RUN, items: [item] };
  withApi(api({ listRuns: () => Promise.resolve(listed([RUN])), readRun: () => Promise.resolve(read) }), history);
  const reason = await waitFor(() => {
    const found = document.querySelector("[data-run-item] .conversion-queue-reason");
    if (found === null) throw new Error("no reason yet");
    return found;
  });
  return reason.textContent;
}

afterEach(cleanup);

describe("what a recorded failure says", () => {
  const en = UI_RESOURCES.en;

  it("names a failure before any report by its error's own sentence", async () => {
    expect(await failureOf(failedItem({ failure: "backend_quarantined" }))).toBe(en.m74CnvNoticeBackendQuarantined);
  });

  it("names a code this build does not know as itself, and never guesses", async () => {
    expect(await failureOf(failedItem({ failure: "later_build_code" }))).toContain("later_build_code");
  });

  it("says a single output's refusal by its outcome", async () => {
    expect(await failureOf(failedItem({ outcome: "output_rejected", failure: "picker_scope_record_mismatch" }))).toBe(en.m74CnvPickerScopeMismatch);
  });

  it("says a set that published part of itself is incomplete, not that it wrote nothing", async () => {
    expect(await failureOf(failedItem({
      outcome: "partial_group", failure: "multi_output_member_rejected", outputs: [FINALIZED, { ...FINALIZED, fileName: "a-2.mzML", state: "rejected" }],
      completeness: { kind: "notPosed" }, setAdoptable: false,
    }))).toBe(en.m74CnvIncompleteSet);
  });

  it("says a set whose every member was published and that still failed what that was, not that it was not produced", async () => {
    expect(await failureOf(failedItem({
      outcome: "complete", outputs: [FINALIZED, { ...FINALIZED, fileName: "a-2.mzML" }],
      completeness: { kind: "established", method: "audit", sampleCount: 2 }, setAdoptable: false,
    }))).toBe(en.runHistorySetNotAdoptable);
  });

  it("prints a code once, when the fallback sentence already names it", async () => {
    await failureOf(failedItem({ failure: "later_build_code" }));
    expect(document.querySelector("[data-run-item] .run-history-code")).toBeNull();
  });

  it("keeps an owned sentence's code beside it", async () => {
    await failureOf(failedItem({ failure: "backend_quarantined" }));
    expect(document.querySelector("[data-run-item] .run-history-code")?.textContent).toBe("backend_quarantined");
  });

  it("shows a time past what a Date holds as a number, and the application stays up", async () => {
    const far = { ...RUN, startedAtMs: 1e19 };
    withApi(api({ listRuns: () => Promise.resolve(listed([far])), readRun: () => Promise.resolve({ outcome: "found", run: far, items: [] }) }), history);
    await waitFor(() => expect(document.querySelector("[data-run-detail] h3")?.textContent).toContain(String(1e19)));
  });
});

describe("why completeness was not established", () => {
  const ids = [
    "source_sample_failure_observed", "source_sample_audit_truncated", "source_sample_audit_unrecognized", "source_sample_output_filtering_requested",
    "source_sample_backend_incomplete", "source_sample_no_published_members", "source_sample_set_not_fully_published",
  ];

  it("has a sentence of its own for every id the reader's audit emits, in both languages", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const { instance } = createUiRuntime();
      void instance.changeLanguage(locale);
      const t = bindUiMessages(instance.t);
      for (const id of ids) expect(completenessSentence(id, t)).not.toContain(id);
      expect(new Set(ids.map((id) => completenessSentence(id, t))).size).toBe(ids.length);
      expect(completenessSentence("later_build_reason", t)).toContain("later_build_reason");
    }
  });
});

describe("a refused request", () => {
  it("does not send the history's reader off to start a conversion again", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const { instance } = createUiRuntime();
      void instance.changeLanguage(locale);
      const t = bindUiMessages(instance.t);
      const refused = { kind: "invalid_conversion_reservation", summary: "", detail: null, retryable: false };
      expect(explainRunHistoryError(refused, t)).toBe(t("runHistoryRequestRefused"));
      const other = { ...refused, kind: "preview_worker_unavailable" };
      expect(explainRunHistoryError(other, t)).toBe(ownedErrorMessage(other, t));
    }
  });
});

describe("the store's problem ids", () => {
  it("each has its own sentence in both languages", () => {
    for (const locale of ["en", "zh-CN"] as const) {
      const { instance } = createUiRuntime();
      void instance.changeLanguage(locale);
      const t = bindUiMessages(instance.t);
      const codes = ["notWritten", "ownerUnavailable", "directoryUnusable", "unsafeDirectory", "newerVersion", "unreadable", "notTurnedOn", "notTurnedOff", "notListed", "notSwept"];
      // The wrapper for a code nobody knows names it; an owned sentence does not.
      for (const code of codes) expect(explainRunHistoryProblem(code, t)).not.toContain(code);
      expect(new Set(codes.map((code) => explainRunHistoryProblem(code, t))).size).toBe(codes.length);
      // The binding's problems are the preference store's, and a stranger is shown as itself.
      expect(explainRunHistoryProblem("rootUnresolved", t)).toBe(t("storageRootUnresolved"));
      expect(explainRunHistoryProblem("something_new", t)).toContain("something_new");
    }
  });
});

describe("the list", () => {
  it("lets the latest read win, whichever answers first", async () => {
    const answers: ((value: RunListOutcome) => void)[] = [];
    const queued = api({ listRuns: () => new Promise((settle) => { answers.push(settle); }) });
    const at = (queueState: string) => <SessionPreferencesProvider><RunHistoryApiProvider value={queued}><ConversionHistory catalog={[]} queueState={queueState} onClose={() => undefined} /></RunHistoryApiProvider></SessionPreferencesProvider>;
    const view = render(at("idle"));
    await waitFor(() => expect(answers.length).toBe(1));
    // A queue that started while the first read was out asks again.
    view.rerender(at("running"));
    await waitFor(() => expect(answers.length).toBe(2));
    await act(async () => {
      answers[1]?.(listed([RUN]));
      await Promise.resolve();
      answers[0]?.(listed([]));
      await Promise.resolve();
    });
    await waitFor(() => expect(document.querySelector(`[data-run-row="${RUN.runId}"]`)).not.toBeNull());
    expect(document.querySelector(".run-history-empty")).toBeNull();
  });

  it("reads again after Off in Settings, so what Off forgot does not stay on screen", async () => {
    let runs: readonly RunSummary[] = [RUN];
    const shared = api({
      listRuns: () => Promise.resolve(listed(runs)),
      setEnabled: () => { runs = []; return Promise.resolve({ outcome: "done", keptInProgress: 0 }); },
    });
    withApi(shared, <>{history}<RunHistorySetting /></>);
    await waitFor(() => expect(document.querySelector("[data-run-row]")).not.toBeNull());
    await waitFor(() => expect(document.querySelector('[data-run-history-toggle="on"]')).not.toBeNull());
    fireEvent.click(document.querySelector('[data-run-history-toggle="on"]')!);
    fireEvent.click(document.querySelector("[data-run-history-off-forget]")!);
    await waitFor(() => expect(document.querySelector("[data-run-row]")).toBeNull());
  });
});
