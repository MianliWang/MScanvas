/**
 * What the installed-backend banner says, from the typed projection it is given.
 *
 * ## Why a projection rather than branches in the component
 *
 * The banner has to tell six different things apart, and two of them are easy
 * to conflate: a request that failed says nothing about whether an installation
 * exists, and a reading that has stopped describing the session is not a
 * verdict about anything. Deciding that in one pure function makes each state
 * nameable, testable and localizable, and makes it impossible for a new
 * translation to accidentally merge two of them.
 *
 * ## Action identity
 *
 * The three recovery paths carry a stable semantic identity -- `recheck`,
 * `choose`, `automatic` -- and never their label. A new verdict re-renders the
 * banner in place and React keeps the button node while relabelling it, so
 * `Search automatically` takes over the slot `Choose folder…` was in. Before
 * M7.5 the component compared `textContent` to decide whether the node was
 * still the action the user pressed, which is a comparison that a translation
 * breaks twice over: the same action reads differently in another language, and
 * a locale change mid-request would make every action look replaced. The
 * identity here is what survives both.
 */

import type { UiMessage, MessageKey } from "../preferences/i18n";
import type { BackendState } from "./usePreviewWorkspace";

/** The semantic identity of one recovery path. Never a label. */
export type BackendActionId = "recheck" | "choose" | "automatic";

export interface BackendAction {
  readonly id: BackendActionId;
  readonly label: string;
}

/**
 * The six states the banner distinguishes, and what each one is entitled to
 * claim.
 *
 * - `checking`: a request is in flight and nothing is claimed.
 * - `requestFailed`: the call itself failed. **Not** an absence: which
 *   installation was in use is exactly what a failed call does not say.
 * - `staleReading`: the authority moved and the reading did not. Nothing in it
 *   -- verdict, release, build date or origin -- describes this session.
 * - `missing`: a usable backend was looked for and not found.
 * - `unsupported`: something was found and it is not usable for MSCanvas --
 *   incomplete, mismatched, or unable to describe the commands needed.
 * - `quarantined`: this session started a ProteoWizard process it cannot say
 *   has ended, so it will start no more. Kept apart from `unsupported`
 *   deliberately: nothing is wrong with the installation, and the recovery is a
 *   restart of MSCanvas rather than a repair of ProteoWizard.
 * - `available`: a usable installation, named.
 */
export type BackendPresentationKind =
  | "checking"
  | "requestFailed"
  | "staleReading"
  | "missing"
  | "unsupported"
  | "quarantined"
  | "available";

export interface BackendPresentation {
  readonly kind: BackendPresentationKind;
  /** `danger` for a failed call, `warning` for no usable backend. */
  readonly tone: "neutral" | "success" | "warning" | "danger";
  readonly title: string;
  /** The explanation, already localized. Empty for `checking`. */
  readonly body: readonly string[];
  /**
   * The owned code behind this state, where there is one.
   *
   * Carried so the banner can show it beside an honest wrapper when this build
   * has no sentence for it. Never a path and never provider output.
   */
  readonly code: string | null;
  /** Whether the reading names a build. False whenever it is not current. */
  readonly names: { readonly release: string | null; readonly buildDate: string | null } | null;
  /** True when msconvert and msaccess come from separate installations. */
  readonly separateInstallations: boolean;
  /** True when the current binding is a folder the user chose this session. */
  readonly chosen: boolean;
  readonly actions: readonly BackendAction[];
}

/**
 * The owned failure codes, each with its own sentence.
 *
 * Every one is authored in this repository: `DiscoveryFailure` and
 * `ChosenFolderProblem` answer `&'static str`, with no path, no provider stderr
 * and no user data in them. So they are translated by code, and a code this
 * build has never seen is wrapped honestly rather than guessed at.
 */
const FAILURE_MESSAGES = {
  backend_not_found: "backendNotFound",
  invalid_configured_location: "backendInvalidLocation",
  msconvert_missing: "backendMsconvertMissing",
  msaccess_missing: "backendMsaccessMissing",
  tool_missing: "backendToolMissing",
  different_installations: "backendDifferentInstallations",
  version_probe_failed: "backendProbeFailed",
  capability_evidence_unavailable: "backendNoCapabilityEvidence",
  // Reachable as a failure kind, and presented as its own state rather than as
  // a verdict about the installation. The sentence is here as well so nothing
  // that looks a code up in this table is left without one.
  backend_quarantined: "backendQuarantinedBody",
  chosen_folder_missing: "backendChosenMissing",
  chosen_folder_not_a_directory: "backendChosenNotAFolder",
  chosen_folder_unreadable: "backendChosenUnreadable",
  chosen_folder_missing_msconvert: "backendChosenNoMsconvert",
  chosen_folder_missing_msaccess: "backendChosenNoMsaccess",
  chosen_folder_missing_both_tools: "backendChosenNoTools",
  chosen_folder_probe_failed: "backendChosenProbeFailed",
  chosen_folder_incompatible_tools: "backendChosenIncompatible",
} as const satisfies Record<string, MessageKey>;

/**
 * Which codes mean "something is installed and MSCanvas cannot use it".
 *
 * The distinction the product owes a reader: nothing installed is a setup step,
 * and an installation that cannot be used is a repair. `backend_not_found` and
 * a chosen folder that is not there are absences; everything else here was
 * found and judged.
 */
const ABSENCE_CODES: readonly string[] = [
  "backend_not_found",
  "chosen_folder_missing",
  "chosen_folder_not_a_directory",
];

/** The localized explanation for one owned failure code. */
export function explainBackendFailure(code: string, message: UiMessage): string {
  const key = Object.hasOwn(FAILURE_MESSAGES, code)
    ? FAILURE_MESSAGES[code as keyof typeof FAILURE_MESSAGES]
    : undefined;
  // Unknown, so it is named rather than dropped or paraphrased. A reader who
  // can quote the code can be helped with it.
  return key === undefined ? message("backendUnknownProblem", { code }) : message(key);
}

function action(id: BackendActionId, message: UiMessage, different = false): BackendAction {
  if (id === "recheck") return { id, label: message("backendRecheck") };
  if (id === "automatic") return { id, label: message("backendAutomatic") };
  // The same action either way -- it opens the same picker and binds the same
  // session choice -- so the identity does not change with the wording. What
  // changes is what the reader is being offered: a first choice, or a
  // replacement for one that turned out to be unusable.
  return { id, label: message(different ? "backendChooseDifferent" : "backendChoose") };
}

/**
 * Both ways out, in a fixed order.
 *
 * Offered together rather than chosen between wherever the banner cannot say
 * which binding is current -- a failed call and a superseded reading are both
 * such cases. Guessing would tell a reader they are on a folder they chose,
 * which is exactly the claim those states exist to withdraw.
 */
function bothWaysOut(message: UiMessage): readonly BackendAction[] {
  return [action("recheck", message), action("choose", message), action("automatic", message)];
}

/**
 * One way out beside `Check again`, picked from the verdict in hand.
 *
 * Read from the verdict rather than from a remembered choice, so a folder the
 * user picked and a verdict about the previous installation cannot appear
 * together.
 */
function switchAway(chosen: boolean, message: UiMessage): readonly BackendAction[] {
  return [action("recheck", message), action(chosen ? "automatic" : "choose", message)];
}

export function presentBackend(
  state: BackendState,
  readingSuperseded: boolean,
  message: UiMessage,
): BackendPresentation {
  const base = {
    body: [] as readonly string[],
    code: null,
    names: null,
    separateInstallations: false,
    chosen: false,
  };

  if (state.status === "checking") {
    // The ways out are offered here too. `busy` disables them for the length of
    // the request, so they cost nothing while one is running -- and a check
    // that ends without producing a verdict, which an authority delivered by a
    // conversion can cause, would otherwise leave this banner reading
    // "checking" with no control of any kind and no way to ask again.
    return {
      ...base,
      kind: "checking",
      tone: "neutral",
      title: message("backendChecking"),
      actions: bothWaysOut(message),
    };
  }

  if (state.status === "failed") {
    // The call failed. Nothing about an installation is claimed, and the
    // summary Rust sent is the one thing that is: it is owned copy about the
    // request, kept as the error's own sentence.
    return {
      ...base,
      kind: "requestFailed",
      tone: "danger",
      title: message("backendRequestFailed"),
      body: [message("backendRequestFailedBody")],
      code: state.error.kind,
      actions: bothWaysOut(message),
    };
  }

  const { availability } = state;
  const chosen = availability.origin === "chosen";

  if (readingSuperseded) {
    // Nothing here is presented as current: not the verdict, not the release,
    // not the build date and not the origin. The reason text survives,
    // attributed to the reading it belongs to rather than dropped.
    return {
      ...base,
      kind: "staleReading",
      tone: "neutral",
      title: message("backendChanged"),
      body: [
        message("backendChangedBody"),
        ...(availability.failure === null
          ? []
          : [message("backendEarlierReading", {
              reading: explainBackendFailure(availability.failure.kind, message),
            })]),
      ],
      code: availability.failure?.kind ?? null,
      actions: bothWaysOut(message),
    };
  }

  if (availability.state === "available") {
    return {
      ...base,
      kind: "available",
      tone: "success",
      title: message("backendAvailable"),
      chosen,
      names: { release: availability.release, buildDate: availability.buildDate },
      separateInstallations: !availability.sameInstallation,
      actions: switchAway(chosen, message),
    };
  }

  const code = availability.failure?.kind ?? null;
  if (code === "backend_quarantined") {
    // Not a verdict about the installation: this session started a process it
    // cannot account for, so it starts no more. The recovery is a restart of
    // MSCanvas, and telling a reader to repair ProteoWizard here would send
    // them after the wrong thing.
    return {
      ...base,
      kind: "quarantined",
      tone: "warning",
      title: message("backendQuarantined"),
      body: [message("backendQuarantinedBody")],
      code,
      chosen,
      // The same ways out as any unavailable state, unchanged. Rust refuses
      // them while quarantined and says so; a banner that removed them would
      // be the only surface offering no way to ask.
      actions: switchAway(chosen, message),
    };
  }
  // Nothing installed is a setup step; an installation MSCanvas cannot use is a
  // repair. A reader is owed the difference, and it is decided from the code
  // rather than from whether a sentence happens to mention a file.
  const absent = code === null || ABSENCE_CODES.includes(code);
  return {
    ...base,
    kind: absent ? "missing" : "unsupported",
    tone: "warning",
    title: message(absent ? "backendMissing" : "backendUnsupported"),
    body: [
      code === null ? message("backendNoUsableBackend") : explainBackendFailure(code, message),
      ...(availability.failure === null ? [] : [message("backendCorrectiveHint")]),
    ],
    code,
    chosen,
    actions: [
      ...switchAway(chosen, message),
      // A chosen folder holding nothing usable leaves the choice in place, so
      // this state needs both: pick a different folder, or stop using one.
      ...(chosen ? [action("choose", message, true)] : []),
    ],
  };
}
