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
import { useUiMessages } from "../preferences/SessionPreferencesProvider";
import { ownedErrorDetail } from "./ownedErrorMessages";
import type { UiMessage } from "../preferences/i18n";

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
import {
  conversionOutcomePassedThenUnpublished,
  conversionOutcomeRefusedByIntegrity,
} from "./contracts";
import { formatByteLength, formatCount } from "./format";

/**
 * What each termination means, in the user's terms.
 *
 * Exhaustive over the identifiers the process boundary publishes, and it must
 * stay that way: an unmapped one falls through to the identifier itself rather
 * than to a friendly word that would be wrong.
 */
const TERMINATION_LABEL = { exited: "cnvTermExited", cancelled: "cnvTermStopped", not_started: "cnvTermNever" } as const;
const STAGED_PHASE_LABEL = { provider_not_invoked: "cnvBeforeProvider", provider_returned: "cnvProviderReturned", output_refused: "cnvOutputRefusedAt", publication_settled: "cnvPublicationSettled" } as const;
const MEMBER_STATE_LABEL = { finalized: "cnvMemberFinalized", validated_not_published: "cnvMemberValidated", rejected: "cnvMemberRejected", not_published: "cnvMemberUnpublished" } as const;
const ADOPTION_REFUSAL_LABEL = { output_missing: "cnvAdoptionReasonMissing", output_changed: "cnvAdoptionReasonChanged", output_unreadable: "cnvAdoptionReasonUnreadable", output_not_mzml: "cnvAdoptionReasonNotMzml", workspace_full: "cnvAdoptionReasonFull" } as const;

export function processSentence(process: ConversionProcessOutcome, t: UiMessage): string {
  switch (process.kind) {
    case "notAttempted": return t("cnvProcessNone");
    case "indeterminate": return t("cnvProcessUnknown");
    case "settled": {
      if (process.termination === "not_started") return t("cnvProcessNotCreated");
      const key = TERMINATION_LABEL[process.termination as keyof typeof TERMINATION_LABEL];
      const ending = key === undefined ? process.termination : t(key);
      return process.exitCode === null ? t("cnvProcessEnded", { ending }) : t("cnvProcessExit", { ending, code: String(process.exitCode) });
    }
  }
}

export function stagedSentence(staged: ConversionStagedOutput, outputCount = 1, t: UiMessage): string {
  switch (staged.kind) {
    case "notCreated": return t("cnvStagedNone");
    case "unobserved": return t("cnvStagedUnknown", { when: t(STAGED_PHASE_LABEL[staged.phase as keyof typeof STAGED_PHASE_LABEL] ?? "cnvStagedAtPoint") });
    case "observed": {
      const when = t(STAGED_PHASE_LABEL[staged.phase as keyof typeof STAGED_PHASE_LABEL] ?? "cnvStagedAtPoint");
      if (staged.entryCount === 0) return t("cnvStagedEmpty", { when });
      if (staged.bounded) return t("cnvStagedBounded", { when, n: formatCount(staged.entryCount - 1) });
      return t("cnvStagedEntries", { when,
        entries: t(staged.entryCount === 1 ? "cnvOneEntry" : "cnvManyEntries", { n: formatCount(staged.entryCount) }),
        content: t(staged.nonEmptyFileObserved ? "cnvHasContent" : "cnvNoContent"),
      }) + (staged.directoryCount === 0 ? "" : t(staged.directoryCount === 1 ? "cnvOneDirectory" : "cnvManyDirectories", { n: formatCount(staged.directoryCount) }));
    }
    case "published": return outputCount <= 1 ? t("cnvStagedPublished") : t("cnvStagedPublishedSet", { n: formatCount(outputCount) });
  }
}

export function finalizedSentence(item: ConversionQueueItem, t: UiMessage): string {
  const single = item.result?.kind === "single" ? item.result.report : null;
  const set = item.result?.kind === "outputSet" ? item.result.report : null;
  if (item.state === "skipped") return t(set === null ? "cnvFinalSkipped" : "cnvFinalSetSkipped");
  if (set !== null) return set.memberCount === 0 ? t("cnvFinalSetNone") : t("cnvFinalCount", { n: formatCount(set.finalizedCount), totalText: formatCount(set.memberCount) });
  return single?.outputFileName != null ? t("cnvFinalOne", { name: single.outputFileName }) : t("cnvFinalNone");
}

export function integritySentence(validation: ConversionValidation | null, perOutput = false, refused = false, passedThenUnpublished = false, reportedMode: string | null = null, t: UiMessage): string {
  const mode = validation?.mode ?? reportedMode;
  const scope = mode === null ? null : mode === "source_comparison" ? t("cnvIntegritySource") : mode === "output_only" ? t("cnvIntegrityOutput") : t("cnvIntegrityModeUnknown", { code: mode });
  if (refused) {
    if (perOutput) return (scope === null ? "" : `${scope}. `) + t("cnvIntegritySetRefused");
    return scope === null ? t("cnvIntegrityRefusedUnknown") : t("cnvIntegrityRefused", { scope });
  }
  if (validation === null) {
    if (passedThenUnpublished) return scope === null ? t("cnvIntegrityUnpublishedUnknown") : t("cnvIntegrityUnpublished", { scope });
    return t("cnvIntegrityNone");
  }
  if (perOutput) return t("cnvIntegrityPerOutput", { scope: scope ?? "" });
  return t("cnvIntegrityCounts", { scope: scope ?? "", checkedText: formatCount(validation.verified.length), unknown: formatCount(validation.unverified.length), inapplicable: formatCount(validation.inapplicable.length) });
}

export function adoptionSentence(adoption: ConversionItemAdoption, finalizedSomething = false, t: UiMessage): string {
  switch (adoption.kind) {
    case "nothingToAdopt": return t(finalizedSomething ? "cnvAdoptionSetUnavailable" : "cnvAdoptionNone");
    case "notRequested": return t("cnvAdoptionNotAsked");
    case "settled": {
      const parts = [t("cnvAddedCount", { n: formatCount(adoption.added) }), t("cnvDuplicateCount", { n: formatCount(adoption.alreadyInWorkspace) }), t("cnvRefusedCount", { n: formatCount(adoption.refused) })];
      const reasons = [...new Set(adoption.refusals.map(code => {
        const key = ADOPTION_REFUSAL_LABEL[code as keyof typeof ADOPTION_REFUSAL_LABEL];
        return key === undefined ? t("cnvAdoptionRefusedCode", { code }) : t(key);
      }))];
      return t("cnvAdoptionHistory", { parts: parts.join(", ") }) + (reasons.length === 0 ? "" : t("cnvAdoptionWhy", { reasons: reasons.join(t("cnvJoinReasons")) }));
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
    return conversionOutcomeRefusedByIntegrity(item.result.report.outcome);
  }
  if (item.result?.kind === "outputSet") {
    return item.result.report.detailedOutcome === "multi_output_member_rejected";
  }
  return false;
}

/**
 * Whether this item's output passed its check and then failed to be published.
 *
 * Both identifiers name a failure that happens strictly after the integrity
 * judgement returned a valid output: the rename did not land, or something
 * appeared at the final name during the run. The validation record travels with
 * a finalization, so neither retains one — and neither may be reported as a run
 * that was never checked.
 */
function passedThenUnpublished(item: ConversionQueueItem): boolean {
  if (item.result?.kind !== "single") {
    return false;
  }
  return conversionOutcomePassedThenUnpublished(item.result.report.outcome);
}

/**
 * The mode the item's own report states, whatever became of its outputs.
 *
 * Both report shapes carry it at the top level, so it survives a refusal that
 * leaves no validation record behind. It is a property of the source posture,
 * decided before anything ran, which is why a run that produced nothing still
 * has one.
 */
function reportedValidationMode(item: ConversionQueueItem): string | null {
  if (item.result?.kind === "outputSet") {
    return item.result.report.validationMode;
  }
  if (item.result?.kind === "single") {
    return item.result.report.validationMode;
  }
  return null;
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
function setPopulation(report: ConversionOutputSetReport, t: UiMessage): string {
  return t("cnvFinalPopulation", { n: formatCount(report.finalizedCount), totalText: formatCount(report.memberCount) });
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
  const t = useUiMessages();
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
        <span aria-hidden="true">{t("cnvDetails")}</span>
        <span className="visually-hidden">{t("cnvDetailsFor", { name: item.fileName })}</span>
      </summary>
      {item.error?.detail == null ? null : <p className="notice-detail">{ownedErrorDetail(item.error, t)}</p>}
      <dl className="metadata-list conversion-item-judgements">
        <div>
          <dt>{t("cnvProcessTitle")}</dt>
          <dd data-testid={`${id}-process`}>{processSentence(item.process, t)}</dd>
        </div>
        <div>
          <dt>{t("cnvStagedTitle")}</dt>
          <dd data-testid={`${id}-staged`}>{stagedSentence(item.staged, manifest.length, t)}</dd>
        </div>
        <div>
          <dt>{t("cnvFinalTitle")}</dt>
          <dd data-testid={`${id}-finalized`}>
            {finalizedSentence(item, t)}
            {set === null || set.partial === null ? null : (
              <> {t("cnvPartialPublication", { population: setPopulation(set, t) })}</>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("cnvIntegrityTitle")}</dt>
          <dd data-testid={`${id}-integrity`}>
            {integritySentence(
              validationOf(item),
              manifest.length > 1,
              integrityRefused(item),
              passedThenUnpublished(item),
              reportedValidationMode(item), t,
            )}
            {advisories.length === 0 ? null : (
              <>
                {" "}
                <span className="conversion-item-advisories">
                  {advisories.length === 1
                    ? t("cnvAdvisoryOne", { codes: advisories[0] ?? "" })
                    : t("cnvAdvisoryMany", { n: formatCount(advisories.length), codes: advisories.join(", ") })}
                </span>
              </>
            )}
          </dd>
        </div>
        <div>
          <dt>{t("cnvAdoptionTitle")}</dt>
          <dd data-testid={`${id}-adoption`}>
            {adoptionSentence(item.adoption, finalizedAnyOutput(item), t)}
          </dd>
        </div>
        <div>
          {/* "Attempt", not "Run". Rust mints this at the owned attempt
              boundary, before the provider is invoked, so a stop that arrived
              after the call and before a process existed carries one beside a
              process judgement that says the converter was never created.
              Calling it a run identity there would give a name to something
              that did not happen -- in the same panel that says it did not. */}
          <dt>{t("cnvRunIdentityTitle")}</dt>
          {/* Named as absent rather than left blank. It is what keeps a
              refusal, a skip or a stop that never reached the boundary from
              reading as an attempt that was made. */}
          <dd data-testid={`${id}-run-identity`}>
            {item.runIdentity === null ? (
              t("cnvRunIdentityNone")
            ) : (
              <code className="conversion-run-identity">{item.runIdentity}</code>
            )}
          </dd>
        </div>
      </dl>
      {manifest.length === 0 ? null : (
        <div className="conversion-item-manifest-scroll">
          <table className="conversion-item-manifest">
            <caption>{t("cnvManifestTitle", { name: item.fileName })}</caption>
            <thead>
              <tr>
                <th scope="col">{t("cnvFileColumn")}</th>
                <th scope="col">{t("cnvStateColumn")}</th>
                <th scope="col">{t("cnvSizeColumn")}</th>
                <th scope="col">{t("cnvSpectraColumn")}</th>
                <th scope="col">{t("cnvChromatogramsColumn")}</th>
                {/* Per member, because a set is judged member by member and the
                    sentence above states only the mode. */}
                <th scope="col">{t("cnvCheckedColumn")}</th>
                <th scope="col">{t("cnvUnverifiedColumn")}</th>
                <th scope="col">{t("cnvInapplicableColumn")}</th>
                <th scope="col">SHA-256</th>
              </tr>
            </thead>
            <tbody>
              {/* Keyed by position as well as name. Two members can share a
                  display string -- the lifecycle matches their facts on the
                  native name precisely because of that -- and two rows with one
                  key are two rows React may reconcile the wrong way round,
                  putting one output's digest beside another's name. */}
              {manifest.map((member, position) => (
                <tr key={`${String(position)}-${member.fileName}`}>
                  {/* `title` as well as the cell, because a backend-chosen
                      basename can be long and the cell wraps rather than
                      clipping. */}
                  <th scope="row" title={member.fileName}>
                    {member.fileName}
                  </th>
                  {/* "Refused" is its own word. A set stops at the first
                      member that fails, so the refused one and every member
                      after it were both unpublished — and only one of them was
                      looked at. A state this surface has no word for is shown
                      as itself, like every other identifier here: answering an
                      unrecognised state with "Not published" would state a fact
                      about the file rather than admit an unread one. */}
                  <td>{(MEMBER_STATE_LABEL[member.state as keyof typeof MEMBER_STATE_LABEL] === undefined ? member.state : t(MEMBER_STATE_LABEL[member.state as keyof typeof MEMBER_STATE_LABEL]))}</td>
                  {/* Nothing measured is nothing shown. A zero here would read
                      as a measured empty document. */}
                  <td>{member.output === null ? "—" : formatByteLength(member.output.byteLength, t)}</td>
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
