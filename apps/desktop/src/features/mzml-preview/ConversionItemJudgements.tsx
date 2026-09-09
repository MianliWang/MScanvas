/**
 * The five judgements of one queue item, made inspectable without five cards.
 *
 * The item row already says what happened in one label. That label is a
 * projection and it is lossy on purpose, so this is where the distinctions it
 * projects from stay reachable: whether a process ran, what the private staging
 * area held, what obtained a final name, what was checked, and what an adoption
 * did. None of the five is derivable from another, and the row's word is not a
 * sixth.
 *
 * A disclosure rather than an always-open block. Sixteen items each showing
 * five sections is a wall nobody reads; the summary line carries the label and
 * the counts, and everything that explains them is one activation away. The
 * element is uncontrolled, so a queue poll that re-renders the list leaves an
 * open disclosure open and a focused control where the user put it.
 */

import type { ReactElement } from "react";

import type {
  ConversionItemAdoption,
  ConversionOutputMember,
  ConversionOutputSetReport,
  ConversionProcessOutcome,
  ConversionQueueItem,
  ConversionReport,
  ConversionStagedOutput,
  ConversionValidation,
} from "./contracts";
import { formatByteLength, formatCount } from "./format";

/**
 * What each termination means, in the user's terms.
 *
 * Exhaustive over the identifiers the process boundary publishes, and it must
 * stay that way: an unmapped one falls through to the identifier itself rather
 * than to a friendly word that would be wrong.
 */
const TERMINATION_LABEL: Record<string, string> = {
  exited: "ran to its own end",
  cancelled: "was terminated after a stop was requested",
  not_started: "was never created",
};

/**
 * When an observation of the staging area was taken.
 *
 * The phase is part of the answer, not decoration. An empty snapshot says the
 * directory was empty *then*; taken after a publication it says nothing at all
 * about what the backend produced, and a reader who cannot see which one they
 * are looking at has been given a fact without its scope.
 */
const STAGED_PHASE_LABEL: Record<string, string> = {
  provider_not_invoked: "before any converter was invoked",
  backend_settled: "when the converter finished",
  output_refused: "after the output was checked and refused",
  publication_settled: "after publication finished",
};

/** Why one adoption refusal happened, in the user's terms. */
const ADOPTION_REFUSAL_LABEL: Record<string, string> = {
  output_missing: "no longer in the destination folder",
  output_changed: "changed since it was converted",
  output_unreadable: "could not be read",
  output_not_mzml: "is no longer a readable mzML file",
  workspace_full: "the workspace is full",
};

/**
 * What the execution boundary established about the process.
 *
 * Read from its own answer rather than from whether process facts came back. A
 * run whose streams could not be captured reports none and may well have
 * created a process, and saying "no converter was started" there would be this
 * surface inventing a fact from an absence.
 */
export function processSentence(process: ConversionProcessOutcome): string {
  switch (process.kind) {
    case "notAttempted":
      return "No converter was started for this item.";
    case "indeterminate":
      return "A converter was started and MSCanvas could not establish how it ended.";
    case "settled": {
      const ending = TERMINATION_LABEL[process.termination] ?? process.termination;
      if (process.termination === "not_started") {
        return "The converter was never created, so no process ran.";
      }
      return process.exitCode === null
        ? `The converter ${ending}.`
        : `The converter ${ending}, exit code ${String(process.exitCode)}.`;
    }
  }
}

/**
 * What the private staging area held.
 *
 * Four answers and not a boolean. "Could not be read" is unknown rather than
 * empty, and "never created" is a third thing again — an item refused before a
 * staging area existed never gave the converter anywhere to write.
 */
export function stagedSentence(staged: ConversionStagedOutput): string {
  switch (staged.kind) {
    case "notCreated":
      // What this establishes is that no converter was given a folder — which
      // covers an attempt that settled before one was made and one whose own
      // setup failed and was torn down. Saying "none was created" would be
      // wrong in the second case and would be claiming more than the boundary
      // reports.
      return "No converter was given a temporary working folder, so nothing could have been written there.";
    case "unobserved":
      return `MSCanvas could not read its temporary working folder ${
        STAGED_PHASE_LABEL[staged.phase] ?? "at that point"
      }, so what it held is unknown.`;
    case "observed": {
      const when = STAGED_PHASE_LABEL[staged.phase] ?? "at that point";
      if (staged.entryCount === 0) {
        return `The temporary working folder was empty ${when}.`;
      }
      const entries = `${formatCount(staged.entryCount)} ${
        staged.entryCount === 1 ? "entry" : "entries"
      }`;
      // "Held bytes" rather than "an output": a staged file with content is not
      // a valid document, and this surface has no judgement that says it is.
      return staged.nonEmptyFileObserved
        ? `The temporary working folder held ${entries} ${when}, at least one of them a file with content.`
        : `The temporary working folder held ${entries} ${when}, none of them a file with content.`;
    }
    case "published":
      return "What was written to the temporary working folder took its final name.";
  }
}

/**
 * What obtained a final name.
 *
 * A partially finalized set says how many of what, and names neither a success
 * nor a failure. A denominator is used only where the population is known: the
 * discovered members of this run, never the lifecycle's maximum bound.
 */
export function finalizedSentence(item: ConversionQueueItem): string {
  const single = item.result?.kind === "single" ? item.result.report : null;
  const set = item.result?.kind === "outputSet" ? item.result.report : null;
  // The conflict policy's own skip is answered first, and for both
  // cardinalities. A set reaches it only when *every* one of its names was
  // occupied, so a count of zero finalized would be arithmetically true and
  // would say nothing about why nothing was written.
  if (item.state === "skipped") {
    return set === null
      ? "Nothing was written. A file of that name was already there and was left alone."
      : "Nothing was written. Files of all of its output names were already there and were left alone.";
  }
  if (set !== null) {
    // What this surface knows is what the run *discovered* and published, not
    // what the converter wrote. A set refused before discovery reports no
    // members, and the converter may still have written documents — the staged
    // judgement beside this one is what says whether it did. So the empty case
    // says nothing obtained a final name, and does not say nothing was
    // produced.
    if (set.memberCount === 0) {
      return "No output file obtained a final name.";
    }
    return `${formatCount(set.finalizedCount)} of ${formatCount(
      set.memberCount,
    )} discovered output files obtained a final name.`;
  }
  if (single?.outputFileName != null) {
    return `One output obtained its final name: ${single.outputFileName}.`;
  }
  return "No output obtained a final name.";
}

/**
 * How an output was judged, and the exact limit of the claim.
 *
 * Output-only stays output-only whatever its sets contain. Advisories are named
 * separately from the three dispositions because none of them is a check that
 * could have been made and was not.
 */
export function integritySentence(
  validation: ConversionValidation | null,
  perOutput = false,
  refused = false,
): string {
  if (validation === null) {
    // The one failure the integrity judgement *causes* must not report that no
    // judgement happened. A refused output was read, judged and discarded, and
    // saying nothing was checked there is the collapse this whole surface
    // exists to undo.
    return refused
      ? "The output was checked against this source posture's contract, did not pass, and was discarded rather than published."
      : "Nothing was checked, because nothing was validated.";
  }
  const scope =
    validation.mode === "source_comparison"
      ? "Compared against the source document"
      : "Output-only. The converted data was not compared against a readable vendor-source model";
  // A set is judged member by member. Printing one member's counts as the
  // item's would be presenting a sample as a total, so where there is more than
  // one output this states the mode — which is a property of the source posture
  // and is therefore the same for all of them — and leaves the counts to the
  // manifest, which carries each member's own.
  if (perOutput) {
    return `${scope}. Each output is judged on its own; the manifest below has every one.`;
  }
  return `${scope}. ${formatCount(validation.verified.length)} checked, ${formatCount(
    validation.unverified.length,
  )} not established, ${formatCount(validation.inapplicable.length)} not applicable.`;
}

/**
 * What an adoption did with this item's outputs.
 *
 * Historical, and the sentence says so: it is what an adoption did, not what
 * the workspace holds now. A row removed afterwards leaves this unchanged,
 * because removing a row deletes no file and undoes no past process outcome.
 */
export function adoptionSentence(
  adoption: ConversionItemAdoption,
  finalizedSomething = false,
): string {
  switch (adoption.kind) {
    case "nothingToAdopt":
      // An item that finalized files and is still not offered was refused by a
      // policy, not by having produced nothing. Attributing the refusal to
      // production would contradict the finalized line directly above it.
      return finalizedSomething
        ? "Not offered. What this item finalized is not a complete output set, and MSCanvas will not add a partial one as though it were the acquisition's. Those files remain in the destination folder."
        : "This item produced nothing that could be added to the workspace.";
    case "notRequested":
      return "Not added yet. Adding outputs to the workspace is something you ask for.";
    case "settled": {
      const parts = [
        `${formatCount(adoption.added)} added`,
        `${formatCount(adoption.alreadyInWorkspace)} already in the workspace`,
        `${formatCount(adoption.refused)} not added`,
      ];
      // One item can hold many outputs and their refusals can differ — an
      // identity check and a full workspace are independent answers — so the
      // reasons are named as the set they are rather than the first one being
      // spoken for all of them.
      const reasons: string[] = [];
      for (const refusal of adoption.refusals) {
        // An identifier this surface has no sentence for is shown as itself.
        // Inventing "could not be verified" would name a reason MSCanvas did
        // not give, which is the one thing a refusal must not do.
        const said = ADOPTION_REFUSAL_LABEL[refusal] ?? `was refused: ${refusal}`;
        if (!reasons.includes(said)) {
          reasons.push(said);
        }
      }
      const why =
        reasons.length === 0
          ? ""
          : reasons.length === 1
            ? ` Not added because ${
                adoption.refusals.length === 1 ? "it" : "each"
              } ${reasons[0] ?? ""}.`
            : ` Not added because: ${reasons.join("; ")}.`;
      return `When outputs were last added: ${parts.join(", ")}.${why}`;
    }
  }
}

/** The manifest entries a single-output item has, which is at most one. */
function singleMember(report: ConversionReport): readonly ConversionOutputMember[] {
  if (report.outputFileName === null || report.output === null) {
    return [];
  }
  return [
    {
      fileName: report.outputFileName,
      state: "finalized",
      output: report.output,
      validation: report.validation,
    },
  ];
}

/** Every output this item produced, whatever its cardinality. */
function manifestOf(item: ConversionQueueItem): readonly ConversionOutputMember[] {
  if (item.result?.kind === "single") {
    return singleMember(item.result.report);
  }
  if (item.result?.kind === "outputSet") {
    return item.result.report.members;
  }
  return [];
}

/**
 * Whether this item's own failure was the integrity judgement refusing.
 *
 * Read from the boundary's identifiers rather than from the absence of a
 * validation record: a refused output carries none, and so does a run that
 * never produced one, and those are opposite answers to "was it checked".
 */
function integrityRefused(item: ConversionQueueItem): boolean {
  if (item.result?.kind === "single") {
    return item.result.report.outcome === "output_rejected";
  }
  if (item.result?.kind === "outputSet") {
    return item.result.report.detailedOutcome === "multi_output_member_rejected";
  }
  return false;
}

/** The validation an item's own judgement sentence is about. */
function validationOf(item: ConversionQueueItem): ConversionValidation | null {
  if (item.result?.kind === "single") {
    return item.result.report.validation;
  }
  if (item.result?.kind === "outputSet") {
    // The first validated member's, because a set is judged member by member
    // under one mode and the mode is what this sentence states. Each member's
    // own properties are in the manifest below.
    return item.result.report.members.find((member) => member.validation !== null)?.validation ?? null;
  }
  return null;
}

/** Whether this item gave any output a final name. */
function finalizedAnyOutput(item: ConversionQueueItem): boolean {
  if (item.result?.kind === "single") {
    return item.result.report.outputFileName !== null;
  }
  if (item.result?.kind === "outputSet") {
    return item.result.report.finalizedCount > 0;
  }
  return false;
}

/** Advisories across every output of this item, de-duplicated and in order. */
function advisoriesOf(item: ConversionQueueItem): readonly string[] {
  const seen: string[] = [];
  for (const member of manifestOf(item)) {
    for (const observation of member.validation?.advisory ?? []) {
      if (!seen.includes(observation)) {
        seen.push(observation);
      }
    }
  }
  return seen;
}

/**
 * How many of the discovered members of a set were finalized.
 *
 * A denominator only where the population is known. `maxMembers` is the
 * lifecycle's bound and is neither the number expected nor the number produced,
 * so it is never the second number here.
 */
function setPopulation(report: ConversionOutputSetReport): string {
  return `${formatCount(report.finalizedCount)} of ${formatCount(report.memberCount)}`;
}

export interface ConversionItemJudgementsProps {
  readonly item: ConversionQueueItem;
  /** The item's position, used only to make ids unique within the list. */
  readonly index: number;
}

/**
 * The disclosure itself.
 *
 * The test hooks are derived from the row's position so two rows cannot share
 * one. The component emits no `id` and no `aria-describedby`: the disclosure's
 * accessible name is its own summary text, which names the row, so there is
 * nothing here for a static id to be duplicated by.
 */
export function ConversionItemJudgements({
  item,
  index,
}: ConversionItemJudgementsProps): ReactElement {
  const id = `conversion-item-${String(index)}`;
  const manifest = manifestOf(item);
  const advisories = advisoriesOf(item);
  const set = item.result?.kind === "outputSet" ? item.result.report : null;
  return (
    <details className="conversion-item-detail" data-testid={`${id}-detail`}>
      <summary>
        {/* The visible word is short; the accessible name says which row it is
            about, because a list of sixteen identical "Details" is a list of
            sixteen unlabelled controls. */}
        <span aria-hidden="true">Details</span>
        <span className="visually-hidden">{`Details for ${item.fileName}`}</span>
      </summary>
      <dl className="metadata-list conversion-item-judgements">
        <div>
          <dt>Process</dt>
          <dd data-testid={`${id}-process`}>{processSentence(item.process)}</dd>
        </div>
        <div>
          <dt>Staged output</dt>
          <dd data-testid={`${id}-staged`}>{stagedSentence(item.staged)}</dd>
        </div>
        <div>
          <dt>Finalized output</dt>
          <dd data-testid={`${id}-finalized`}>
            {finalizedSentence(item)}
            {set === null || set.partial === null ? null : (
              <> {`Publication stopped partway: ${setPopulation(set)}.`}</>
            )}
          </dd>
        </div>
        <div>
          <dt>Integrity</dt>
          <dd data-testid={`${id}-integrity`}>
            {integritySentence(validationOf(item), manifest.length > 1, integrityRefused(item))}
            {advisories.length === 0 ? null : (
              <>
                {" "}
                <span className="conversion-item-advisories">
                  {advisories.length === 1
                    ? `One advisory observation, which fails nothing: ${advisories[0] ?? ""}.`
                    : `${formatCount(advisories.length)} kinds of advisory observation, which fail nothing: ${advisories.join(", ")}.`}
                </span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>Adoption</dt>
          <dd data-testid={`${id}-adoption`}>
            {adoptionSentence(item.adoption, finalizedAnyOutput(item))}
          </dd>
        </div>
        <div>
          <dt>Run identity</dt>
          {/* Named as absent rather than left blank. It is what keeps a
              refusal, a skip or a stop that beat the launch from reading as a
              run that happened. */}
          <dd data-testid={`${id}-run-identity`}>
            {item.runIdentity === null ? (
              "No converter run: none was started for this item."
            ) : (
              <code className="conversion-run-identity">{item.runIdentity}</code>
            )}
          </dd>
        </div>
      </dl>
      {manifest.length === 0 ? null : (
        <div className="conversion-item-manifest-scroll">
          <table className="conversion-item-manifest">
            <caption>{`Outputs of ${item.fileName}`}</caption>
            <thead>
              <tr>
                <th scope="col">File</th>
                <th scope="col">State</th>
                <th scope="col">Size</th>
                <th scope="col">Spectra</th>
                <th scope="col">Chromatograms</th>
                {/* Per member, because a set is judged member by member and the
                    sentence above states only the mode. */}
                <th scope="col">Checked</th>
                <th scope="col">Not established</th>
                <th scope="col">Not applicable</th>
                <th scope="col">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {manifest.map((member) => (
                <tr key={member.fileName}>
                  {/* `title` as well as the cell, because a backend-chosen
                      basename can be long and the cell wraps rather than
                      clipping. */}
                  <th scope="row" title={member.fileName}>
                    {member.fileName}
                  </th>
                  <td>{member.state === "finalized" ? "Finalized" : "Not published"}</td>
                  {/* Nothing measured is nothing shown. A zero here would read
                      as a measured empty document. */}
                  <td>{member.output === null ? "—" : formatByteLength(member.output.byteLength)}</td>
                  <td>{member.output === null ? "—" : formatCount(member.output.spectrumCount)}</td>
                  <td>
                    {member.output === null ? "—" : formatCount(member.output.chromatogramCount)}
                  </td>
                  <td>
                    {member.validation === null
                      ? "—"
                      : formatCount(member.validation.verified.length)}
                  </td>
                  <td>
                    {member.validation === null
                      ? "—"
                      : formatCount(member.validation.unverified.length)}
                  </td>
                  <td>
                    {member.validation === null
                      ? "—"
                      : formatCount(member.validation.inapplicable.length)}
                  </td>
                  <td>
                    {member.output === null ? (
                      "—"
                    ) : (
                      <code className="conversion-item-digest" title={member.output.sha256}>
                        {member.output.sha256}
                      </code>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </details>
  );
}
