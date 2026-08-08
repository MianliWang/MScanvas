import type { ReactElement } from "react";

import type {
  ConversionConflictPolicy,
  ConversionReport,
  SelectedFile,
  WorkspaceConversionState,
} from "./contracts";
import { formatByteLength, formatCount, formatDuration } from "./format";
import type { ConversionOperation } from "./useConversionOperation";

/**
 * What each conflict policy means, in the user's terms rather than the
 * boundary's. Exhaustive over the union, so a third policy fails compilation
 * here rather than rendering as a blank radio.
 */
const CONFLICT_POLICY_LABEL: Record<ConversionConflictPolicy, string> = {
  fail: "Stop if a file of that name already exists",
  skip: "Skip if a file of that name already exists",
};

const CONFLICT_POLICIES: readonly ConversionConflictPolicy[] = ["fail", "skip"];

/**
 * The one sentence this workflow must always say about what it verified.
 *
 * A vendor acquisition has no mzML reading, so nothing about the output can be
 * compared to a source model. Saying so before the conversion and again after
 * it is the difference between a checked file and a file that merely converted
 * without erroring.
 */
const OUTPUT_ONLY_DISCLOSURE =
  "Output-only validation. This does not compare the converted data with a readable vendor-source spectrum model.";

/** What each staging residue means for the folder the user chose. */
const RESIDUE_EXPLANATION = "MSCanvas could not remove its own temporary folder afterwards.";

export interface ConversionPanelProps {
  readonly conversion: ConversionOperation;
  /** The row the keyboard is on, which is the row this panel is about. */
  readonly focused: SelectedFile | null;
  /** Whether anything else is already occupying the one backend lane. */
  readonly canConvert: boolean;
}

/**
 * The focused row's conversion: what it would do, and what it did.
 *
 * Acts on exactly one row — the focused one — and never on the selection. A
 * selection is a set the user built for removing rows; converting is one
 * acquisition at a time, and an action that read the selection would be an
 * action whose scope changed as they curated the list.
 */
export function ConversionPanel({
  conversion,
  focused,
  canConvert,
}: ConversionPanelProps): ReactElement | null {
  const { state, plan } = conversion;
  const terminal = state.status === "completed" || state.status === "failed";

  // Nothing to say. The panel is not a permanent fixture: with no convertible
  // row focused and no operation to report, it would be a heading over an empty
  // space in the one column the roster is trying to use.
  if (!conversion.busy && !terminal && plan.status === "none") {
    return null;
  }

  return (
    <section
      aria-busy={conversion.busy}
      aria-labelledby="conversion-panel-heading"
      className="panel conversion-panel"
    >
      <header className="panel-header compact">
        <div>
          <h2 id="conversion-panel-heading">Convert</h2>
          <p>One acquisition at a time. The original file is never changed.</p>
        </div>
      </header>

      {conversion.error === null ? null : (
        <div className="notice notice-danger" role="status">
          <span>{conversion.error.summary}</span>
          <button className="link-button" onClick={conversion.dismissError} type="button">
            Dismiss
          </button>
        </div>
      )}

      {conversion.busy ? (
        <RunningState state={state} />
      ) : (
        <>
          {terminal ? <TerminalState state={state} /> : null}
          {/* Shown beside the last result rather than instead of it. Rust's
              slot lets a new conversion replace the previous report, so a panel
              that only ever rendered the report would make the second
              conversion of a session reachable by reloading the application and
              no other way. The report is what just happened; the plan is what
              would happen next, and both are true at once. */}
          {plan.status === "none" ? null : (
            <PlanState
              canConvert={canConvert}
              conversion={conversion}
              focused={focused}
              repeating={terminal}
            />
          )}
        </>
      )}
    </section>
  );
}

/** What a conversion would do, and the one control that starts it. */
function PlanState({
  conversion,
  focused,
  canConvert,
  repeating,
}: {
  readonly conversion: ConversionOperation;
  readonly focused: SelectedFile | null;
  readonly canConvert: boolean;
  /** Whether a previous result is on screen above this plan. */
  readonly repeating: boolean;
}): ReactElement | null {
  const { plan } = conversion;
  // With a result above it, silence is better than a second empty state: the
  // report already says what the panel is about.
  if (repeating && plan.status !== "loaded") {
    return null;
  }
  if (plan.status === "loading") {
    return <div className="empty-state">Reading the conversion plan…</div>;
  }
  if (plan.status === "failed") {
    return (
      <div className="empty-state">
        <span>{plan.error.summary}</span>
      </div>
    );
  }
  if (plan.status === "none") {
    return <div className="empty-state">Focus a Thermo RAW row to convert it.</div>;
  }

  const summary = plan.plan;
  const name = focused?.handle === summary.dataset.handle ? focused.fileName : summary.dataset.fileName;
  return (
    <div className="conversion-plan">
      <dl className="metadata-list">
        <div>
          <dt>Source</dt>
          <dd title={name}>{name}</dd>
        </div>
        <div>
          <dt>Family</dt>
          <dd>Thermo RAW</dd>
        </div>
        <div>
          <dt>Output</dt>
          <dd>{summary.outputFormat}</dd>
        </div>
        <div>
          <dt>Compression</dt>
          <dd>{summary.compression}</dd>
        </div>
      </dl>

      <p className="quiet-text" id="conversion-validation-disclosure" role="note">
        {OUTPUT_ONLY_DISCLOSURE}
      </p>

      <fieldset className="conversion-conflict">
        <legend>If the output name is taken</legend>
        {CONFLICT_POLICIES.map((policy) => (
          <label key={policy}>
            <input
              checked={conversion.conflictPolicy === policy}
              name="conversion-conflict-policy"
              onChange={() => {
                conversion.setConflictPolicy(policy);
              }}
              type="radio"
              value={policy}
            />
            {CONFLICT_POLICY_LABEL[policy]}
          </label>
        ))}
      </fieldset>

      <div className="conversion-actions">
        <button
          aria-describedby="conversion-validation-disclosure"
          className="primary-button"
          disabled={!canConvert}
          onClick={() => {
            conversion.convert(summary.dataset.handle);
          }}
          type="button"
        >
          Convert focused…
        </button>
      </div>
    </div>
  );
}

/**
 * A conversion under way.
 *
 * No percentage and no cancel. Nothing measures a fraction of a `msconvert`
 * run, and this workflow genuinely cannot stop one — so it says so instead of
 * offering a control that would only stop watching.
 */
function RunningState({ state }: { readonly state: WorkspaceConversionState }): ReactElement {
  const name =
    state.status === "awaitingDestination" || state.status === "running"
      ? state.dataset.fileName
      : "";
  return (
    <div className="conversion-running">
      <p>
        {state.status === "awaitingDestination"
          ? "Choose where to save the converted mzML."
          : "Conversion in progress…"}
      </p>
      <p className="quiet-text" title={name}>
        {name}
      </p>
      <p className="quiet-text" role="note">
        This first conversion workflow cannot cancel a running conversion.
      </p>
    </div>
  );
}

/** What the last operation did. */
function TerminalState({ state }: { readonly state: WorkspaceConversionState }): ReactElement {
  if (state.status === "failed") {
    return (
      <div className="notice notice-danger" role="status">
        <span>{state.error.summary}</span>
      </div>
    );
  }
  if (state.status !== "completed") {
    return <div className="empty-state">Nothing to report.</div>;
  }
  return <ConversionOutcome report={state.report} />;
}

/**
 * One finished conversion, told apart by what it actually did.
 *
 * `finalized`, `skipped` and everything else are three different answers and
 * are never collapsed: one produced a file, one deliberately left a file alone,
 * and the rest produced nothing.
 */
function ConversionOutcome({ report }: { readonly report: ConversionReport }): ReactElement {
  const residue =
    report.stagingResidue === null ? null : (
      <p className="notice notice-warning" role="note">
        {RESIDUE_EXPLANATION}
      </p>
    );

  if (report.outcome === "finalized" && report.output !== null) {
    return (
      <div className="conversion-result">
        <p className="conversion-result-headline">
          Converted <strong title={report.outputFileName ?? ""}>{report.outputFileName}</strong>
        </p>
        <dl className="metadata-list">
          <div>
            <dt>Size</dt>
            <dd>{formatByteLength(report.output.byteLength)}</dd>
          </div>
          <div>
            <dt>Spectra</dt>
            <dd>{formatCount(report.output.spectrumCount)}</dd>
          </div>
          <div>
            <dt>Chromatograms</dt>
            <dd>{formatCount(report.output.chromatogramCount)}</dd>
          </div>
          {report.backend === null ? null : (
            <div>
              <dt>Took</dt>
              <dd>{formatDuration(report.backend.elapsedMilliseconds)}</dd>
            </div>
          )}
        </dl>
        <p className="quiet-text" role="note">
          {OUTPUT_ONLY_DISCLOSURE}
        </p>
        <p className="quiet-text">
          The converted file was not added to the workspace. Add it with Add files… when you want
          to look at it.
        </p>
        {residue}
      </div>
    );
  }

  if (report.outcome === "skipped_existing_destination") {
    return (
      <div className="conversion-result">
        <p className="conversion-result-headline">
          A file of that name was already there, and was left untouched.
        </p>
        <p className="quiet-text">
          MSCanvas did not inspect it and did not convert anything. Choose another folder, or move
          the existing file, to convert this acquisition.
        </p>
        {residue}
      </div>
    );
  }

  return (
    <div className="conversion-result">
      <p className="notice notice-danger" role="status">
        {failureSentence(report)}
      </p>
      {residue}
    </div>
  );
}

/**
 * What a failed conversion says.
 *
 * Grouped by the boundary's own outcome and explained by its detailed one, with
 * a fallback that is honest rather than specific: an identifier this build has
 * no sentence for is still a failure, and inventing prose for it would be
 * inventing a diagnosis.
 */
function failureSentence(report: ConversionReport): string {
  switch (report.detailedOutcome) {
    case "destination_exists":
      return "A file of that name is already in that folder, so nothing was converted.";
    case "source_family_not_evidenced":
      return "MSCanvas has no conversion evidence for this acquisition format on the installed ProteoWizard build.";
    case "output_rejected":
      return "The converted file did not pass MSCanvas' integrity checks, so it was discarded.";
    default:
      return "The conversion did not finish, so no file was written.";
  }
}
