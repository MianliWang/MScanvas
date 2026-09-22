import { createInstance, type i18n, type TFunction } from "i18next";

import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";
import type { UiLocale } from "./sessionPreferences";

export const UI_RESOURCES = { en, "zh-CN": zhCN } as const;
type PluralKey = "projectMemberCount" | "projectRunInputs" | "projectArtifactMembers" | "rosterRetainedAnnouncement" | "rosterRows" | "dragPicked" | "dragCount" | "dropRelease" | "noticeAdded" | "noticeDuplicates" | "noticeUnreadable" | "noticeFull" | "noticeRemoved" | "noticeGone" | "noticeCleared" | "noticeFolderLinked" | "noticeFolderInaccessible" | "noticeDropLinkedRoot" | "noticeDropInaccessibleRoot" | "noticeDropRemoteRoot" | "noticeDropUnsupportedRoot" | "noticeDropLinkedEntry" | "noticeDropInaccessibleEntry";
export type MessageKey = Exclude<keyof typeof en, `${PluralKey}_${string}`> | PluralKey;
export interface MessageParameters {
  readonly projectMemberCount: { readonly count: number };
  readonly projectRunInputs: { readonly count: number };
  readonly projectArtifactMembers: { readonly count: number };
  readonly projectRunVersion: { readonly version: string };
  readonly projectRelinkNamed: { readonly name: string };
  readonly projectRemoveNamed: { readonly name: string };
  readonly projectSelectNamed: { readonly name: string };
  readonly provenanceInspectInput: { readonly name: string };
  readonly provenanceInspectRun: { readonly name: string };
  readonly provenanceInspectArtifact: { readonly name: string };
  readonly m74ErrorFigureSize: { readonly minWidth: number; readonly minHeight: number; readonly max: number };
  readonly m74ErrorDpi: { readonly min: number; readonly max: number };
  readonly m74ErrorRasterBudget: { readonly max: number };
  readonly m74ErrorExtension: { readonly extension: string };
  readonly m74CnvAnnounceRetry: { readonly count: number };
  readonly m74CnvAnnounceRunning: { readonly count: number };
  readonly m74CnvAnnounceStoppingItem: { readonly name: string };
  readonly m74CnvAnnounceSkipping: { readonly name: string };
  readonly m74CnvAnnounceItem: { readonly position: number; readonly total: number; readonly name: string };
  readonly m74CnvNamedDestination: { readonly name: string };
  readonly m74CnvOneFamily: { readonly family: string };
  readonly m74CnvManyFamily: { readonly count: number; readonly family: string };
  readonly m74CnvMixedFamilies: { readonly count: number; readonly families: string };
  readonly m74CnvOutputBound: { readonly count: number };
  readonly m74CnvAdoptionSummary: { readonly added: string; readonly duplicates: string; readonly refused: string };
  readonly m74CnvMoreRefused: { readonly count: number };
  readonly m74CnvManyReady: { readonly count: number };
  readonly m74CnvManyDiagnostics: { readonly count: number };
  readonly m74CnvConvertSelected: { readonly count: number };
  readonly m74CnvConvertAll: { readonly count: number };
  readonly m74CnvRunningItem: { readonly position: number; readonly total: number };
  readonly m74CnvBetweenItems: { readonly count: number; readonly total: number };
  readonly m74CnvSkipping: { readonly name: string };
  readonly m74CnvSkip: { readonly name: string };
  readonly m74CnvAttempt: { readonly count: number };
  readonly m74CnvRetry: { readonly count: number };
  readonly m74CnvManyOutputs: { readonly count: number };
  readonly m74CnvManyFinalized: { readonly count: number };
  readonly m74CnvNotAdded: { readonly name: string; readonly reason: string };
  readonly m74CnvDiagnosticsSaved: { readonly name: string; readonly bytes: string; readonly items: string };
  readonly m74CnvDiagnosticItems: { readonly count: number };
  readonly m74CnvScopeCounts: { readonly requested: string; readonly eligible: string; readonly excluded: string };
  readonly m74CnvOrder: { readonly order: string };
  readonly m74CnvCapacity: { readonly count: number };
  readonly m74CnvCapacityExceeded: { readonly count: number; readonly capacity: number };
  readonly m74CnvCancelNamed: { readonly name: string };
  readonly m74CnvOutputMetrics: { readonly bytes: string; readonly spectra: string; readonly chromatograms: string };
  readonly m74CnvPartialCounts: { readonly count: number; readonly total: number; readonly unpublished: string };
  readonly m74CnvCountConverted: { readonly count: number };
  readonly m74CnvCountSkipped: { readonly count: number };
  readonly m74CnvCountFailed: { readonly count: number };
  readonly m74CnvCountCancelled: { readonly count: number };
  readonly m74CnvCountUserSkipped: { readonly count: number };
  readonly m74CnvCountNotRun: { readonly count: number };
  readonly m74CnvCountUnconfirmed: { readonly count: number };
  readonly m74CnvQueueCounts: { readonly parts: string; readonly total: number };
  readonly cnvProcessEnded: { readonly ending: string };
  readonly cnvProcessExit: { readonly code: string; readonly ending: string };
  readonly cnvStagedUnknown: { readonly when: string };
  readonly cnvStagedEmpty: { readonly when: string };
  readonly cnvStagedBounded: { readonly n: string; readonly when: string };
  readonly cnvStagedEntries: { readonly content: string; readonly entries: string; readonly when: string };
  readonly cnvOneEntry: { readonly n: string };
  readonly cnvManyEntries: { readonly n: string };
  readonly cnvOneDirectory: { readonly n: string };
  readonly cnvManyDirectories: { readonly n: string };
  readonly cnvStagedPublishedSet: { readonly n: string };
  readonly cnvFinalCount: { readonly n: string; readonly totalText: string };
  readonly cnvFinalOne: { readonly name: string };
  readonly cnvIntegrityModeUnknown: { readonly code: string };
  readonly cnvIntegrityRefused: { readonly scope: string };
  readonly cnvIntegrityUnpublished: { readonly scope: string };
  readonly cnvIntegrityPerOutput: { readonly scope: string };
  readonly cnvIntegrityCounts: { readonly checkedText: string; readonly inapplicable: string; readonly scope: string; readonly unknown: string };
  readonly cnvAddedCount: { readonly n: string };
  readonly cnvDuplicateCount: { readonly n: string };
  readonly cnvRefusedCount: { readonly n: string };
  readonly cnvAdoptionRefusedCode: { readonly code: string };
  readonly cnvAdoptionWhy: { readonly reasons: string };
  readonly cnvAdoptionHistory: { readonly parts: string };
  readonly cnvDetailsFor: { readonly name: string };
  readonly cnvPartialPublication: { readonly population: string };
  readonly cnvFinalPopulation: { readonly n: string; readonly totalText: string };
  readonly cnvAdvisoryOne: { readonly codes: string };
  readonly cnvAdvisoryMany: { readonly codes: string; readonly n: string };
  readonly cnvManifestTitle: { readonly name: string };
  readonly outputOpenGroup: { readonly name: string };
  readonly figurePreviewRefused: { readonly code: string };
  readonly stagingRecoveryOwned: { readonly count: number };
  readonly clearCounts: { readonly count: number; readonly total: number; readonly protected: string };
  readonly linkedHeight: { readonly value: string };
  readonly viewerExportRtHelp: { readonly low: string; readonly high: string };
  readonly viewerLinkedExport: { readonly name: string };
  readonly viewerLinkedExporting: { readonly name: string };
  readonly viewerLinkedCopied: { readonly width: string; readonly height: string; readonly theme: string; readonly index: string; readonly count: number };
  readonly viewerLinkedSaved: { readonly name: string; readonly index: string; readonly rt: string; readonly count: number };
  readonly viewerChromCopied: { readonly width: string; readonly height: string; readonly theme: string; readonly count: number };
  readonly viewerChromSource: { readonly count: number };
  readonly viewerChromRows: { readonly count: number; readonly total: number };
  readonly viewerChromSaved: { readonly name: string; readonly details: string };
  readonly plotSticks: { readonly count: number };
  readonly plotTransferReduced: { readonly sticks: string; readonly count: number };
  readonly plotTransferExact: { readonly sticks: string };
  readonly plotObservations: { readonly sticks: string; readonly count: number; readonly low: string; readonly high: string };
  readonly plotNegativeMixed: { readonly count: number };
  readonly plotNegativeCount: { readonly count: number };
  readonly plotCaption: { readonly count: number; readonly total: number };
  readonly plotTransferCaption: { readonly count: number; readonly total: number };
  readonly viewerShowing: { readonly low: string; readonly high: string };
  readonly viewerScanSource: { readonly count: number };
  readonly viewerScanReadout: { readonly name: string; readonly index: string; readonly scan: string; readonly level: string; readonly rt: string; readonly tic: string; readonly bpc: string };
  readonly viewerReportedScan: { readonly index: string };
  readonly viewerMzShowing: { readonly low: string; readonly high: string };
  readonly viewerMzLoading: { readonly low: string; readonly high: string };
  readonly viewerMzEmpty: { readonly low: string; readonly high: string };
  readonly viewerSpectrumLoading: { readonly index: string };
  readonly viewerSpectrumIndex: { readonly index: string };
  readonly viewerSpectrumAbsent: { readonly index: string };
  readonly viewerSpectrumFailed: { readonly index: string };
  readonly viewerSpectrumUnavailable: { readonly index: string };
  readonly viewerSpectrumSummary: { readonly index: string; readonly level: string; readonly count: number };
  readonly viewerSpectrumPrefixRetained: { readonly count: number };
  readonly viewerSpectrumPrefix: { readonly count: number };
  readonly viewerPrecursorPrefix: { readonly count: number; readonly total: number };
  readonly viewerRetentionValue: { readonly value: string };
  readonly viewerBasePeakValue: { readonly mz: string; readonly value: string };
  readonly viewerLoadedNone: { readonly count: number };
  readonly viewerSpectrumLoaded: { readonly index: string; readonly count: number };
  readonly viewerExportRangeHelp: { readonly low: string; readonly high: string };
  readonly viewerExportFormat: { readonly name: string };
  readonly viewerExporting: { readonly name: string };
  readonly viewerExportChoose: { readonly name: string };
  readonly viewerExportPoints: { readonly count: number };
  readonly viewerExportPointRange: { readonly count: number; readonly total: number; readonly low: string; readonly high: string };
  readonly viewerExportSaved: { readonly name: string; readonly details: string };
  readonly viewerExportCopied: { readonly details: string };
  readonly viewerFigureSize: { readonly width: string; readonly height: string; readonly theme: string };
  readonly rangeCommitted: { readonly name: string; readonly low: string; readonly high: string };
  readonly rangePending: { readonly name: string; readonly low: string; readonly high: string };
  readonly rangeConfirmContext: { readonly name: string; readonly low: string; readonly high: string };
  readonly rangeEdit: { readonly name: string };
  readonly scanCounts: { readonly visible: number; readonly count: number; readonly total: number };
  readonly scanSelectedOutside: { readonly name: string };
  readonly rosterRetainedAnnouncement: { readonly count: number };
  readonly dropRelease: { readonly count: number };
  readonly noticeAdded: { readonly count: number };
  readonly noticeDuplicates: { readonly count: number };
  readonly noticeUnreadable: { readonly count: number };
  readonly noticeFull: { readonly count: number };
  readonly noticeRemoved: { readonly count: number };
  readonly noticeGone: { readonly count: number };
  readonly noticeCleared: { readonly count: number };
  readonly noticeFolderLinked: { readonly count: number };
  readonly noticeFolderInaccessible: { readonly count: number };
  readonly noticeDropLinkedRoot: { readonly count: number };
  readonly noticeDropInaccessibleRoot: { readonly count: number };
  readonly noticeDropRemoteRoot: { readonly count: number };
  readonly noticeDropUnsupportedRoot: { readonly count: number };
  readonly noticeDropLinkedEntry: { readonly count: number };
  readonly noticeDropInaccessibleEntry: { readonly count: number };
  readonly moreNotListed: { readonly count: number };
  readonly workspaceAnnouncement: { readonly message: string };
  readonly noticeDuplicate: { readonly name: string };
  readonly noticeRejected: { readonly name: string; readonly summary: string };
  readonly noticeFolderLimit: { readonly reasons: string };
  readonly noticeDropLimit: { readonly reasons: string };
  readonly noticeListPair: { readonly left: string; readonly right: string };
  readonly noticeListComma: { readonly left: string; readonly right: string };
  readonly rosterRows: { readonly count: number };
  readonly dragPicked: { readonly count: number };
  readonly dragCount: { readonly count: number };
  readonly selectionContext: { readonly total: number; readonly hidden: number; readonly checked: number };
  readonly rosterContext: { readonly total: number; readonly visible: number; readonly capacity: number };
  readonly groupActions: { readonly name: string };
  readonly rowActions: { readonly name: string };
  readonly previewRetained: { readonly name: string };
  readonly moveHandle: { readonly name: string };
  readonly checkAcquisition: { readonly name: string };
  readonly checkGroup: { readonly name: string; readonly count: number };
  readonly groupDisclosure: { readonly name: string; readonly count: number };
  readonly dragTarget: { readonly name: string; readonly count: number; readonly position: number; readonly total: number };
  readonly resourceCode: { readonly code: string };
  readonly storageUnknownProblem: { readonly code: string };
  readonly backendEarlierReading: { readonly reading: string };
  readonly backendBuiltOn: { readonly date: string };
  readonly backendProblemCode: { readonly code: string };
  readonly backendUnknownProblem: { readonly code: string };
  readonly summaryIdentity: { readonly name: string; readonly size: string };
  readonly summaryCountsDisagree: { readonly summary: string; readonly list: string };
  readonly summaryMsLevelsTruncated: { readonly shown: string; readonly total: string };
  readonly summarySectionTruncated: { readonly shown: string; readonly total: string };
  readonly errorUnknownProblem: { readonly code: string };
  readonly errorReportedAsSent: { readonly summary: string };
  readonly formatBytes: { readonly count: number };
  readonly measureOpenDetail: { readonly rows: string };
  readonly measureRowDetail: { readonly index: string };
  readonly measureTableDetail: { readonly rows: string };
  readonly unknownFigureProblem: { readonly code: string };
}
export type MessageArguments<K extends MessageKey> = K extends keyof MessageParameters
  ? [parameters: MessageParameters[K]] : [];
export type UiMessage = <K extends MessageKey>(key: K, ...args: MessageArguments<K>) => string;

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "ui";
    resources: { ui: typeof en };
    enableSelector: false;
    strictKeyChecks: true;
    returnNull: false;
  }
}

export class ResourceProblem extends Error {
  constructor(readonly code: "RESOURCE_MISSING" | "RESOURCE_EMPTY" | "RESOURCE_KEYS" | "RESOURCE_PARAMETERS" | "RESOURCE_INIT", readonly key?: string) {
    super(key === undefined ? code : `${code}: ${key}`);
  }
}

const pluralKeys: readonly PluralKey[] = ["projectMemberCount", "projectRunInputs", "projectArtifactMembers", "rosterRetainedAnnouncement", "rosterRows", "dragPicked", "dragCount", "dropRelease", "noticeAdded", "noticeDuplicates", "noticeUnreadable", "noticeFull", "noticeRemoved", "noticeGone", "noticeCleared", "noticeFolderLinked", "noticeFolderInaccessible", "noticeDropLinkedRoot", "noticeDropInaccessibleRoot", "noticeDropRemoteRoot", "noticeDropUnsupportedRoot", "noticeDropLinkedEntry", "noticeDropInaccessibleEntry"];
const simpleKeys = Object.keys(en).filter((key) => !pluralKeys.some(base => key.startsWith(`${base}_`)));
const parameters = (message: string): string =>
  [...new Set([...message.matchAll(/\{\{\s*(\w+)(?:,\s*number)?\s*\}\}/gu)].map((match) => match[1]))].sort().join(",");

/** Required parameters at both the typed call site and the untyped boundary. */
export function bindUiMessages(t: TFunction<"ui">): UiMessage {
  return <K extends MessageKey>(key: K, ...args: MessageArguments<K>): string => {
    const plural = pluralKeys.includes(key as PluralKey);
    if (!plural && !simpleKeys.includes(key)) throw new ResourceProblem("RESOURCE_KEYS", key);
    const values = args[0];
    const baseline = en[(plural ? `${key}_other` : key) as keyof typeof en];
    for (const parameter of parameters(baseline).split(",").filter(Boolean)) {
      const value = (values as Record<string, unknown> | undefined)?.[parameter];
      const numeric = ["count", "total", "hidden", "checked", "visible", "capacity", "position", "min", "max", "minWidth", "minHeight"].includes(parameter);
      if (numeric ? typeof value !== "number" || !Number.isSafeInteger(value) || value < 0 :
        typeof value !== "string" || value.trim() === "") throw new ResourceProblem("RESOURCE_PARAMETERS", key);
    }
    // The generic engine call is behind the typed key/argument API and explicit runtime validation.
    return (t as (key: string, options?: object) => string)(key, values);
  };
}

/** Exact locale coverage, before i18next fallback can obscure a missing value. */
export function validateBundle(locale: UiLocale, bundle: unknown): void {
  if (typeof bundle !== "object" || bundle === null || Array.isArray(bundle)) {
    throw new ResourceProblem("RESOURCE_MISSING");
  }
  const values = bundle as Record<string, unknown>;
  const plurals = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const expected = [...simpleKeys, ...pluralKeys.flatMap(base => plurals.map(plural => `${base}_${plural}`))];
  if (Object.keys(values).some((key) => !expected.includes(key))) throw new ResourceProblem("RESOURCE_KEYS");
  for (const key of expected) {
    if (!(key in values)) throw new ResourceProblem("RESOURCE_MISSING", key);
    const value = values[key];
    if (typeof value !== "string" || value.trim() === "") throw new ResourceProblem("RESOURCE_EMPTY", key);
    const base = pluralKeys.find(base => key.startsWith(`${base}_`));
    const baseline = en[(base === undefined ? key : `${base}_other`) as keyof typeof en];
    if (parameters(value) !== parameters(baseline)) throw new ResourceProblem("RESOURCE_PARAMETERS", key);
  }
}

export interface UiRuntime {
  readonly instance: i18n;
  readonly initialProblem: ResourceProblem | null;
}

/** One stable, local instance per app session (and per integration test). */
export function createUiRuntime(resources: { en: unknown; "zh-CN": unknown } = UI_RESOURCES): UiRuntime {
  let initialProblem: ResourceProblem | null = null;
  try {
    validateBundle("en", resources.en);
    validateBundle("zh-CN", resources["zh-CN"]);
  } catch (error) {
    initialProblem = error instanceof ResourceProblem ? error : new ResourceProblem("RESOURCE_INIT");
  }
  const usable = initialProblem === null ? resources : UI_RESOURCES;
  // The local baseline is validated separately; it is recovery, not coverage of
  // the failed input. Nothing in this instance has a detector or remote backend.
  validateBundle("en", UI_RESOURCES.en);
  validateBundle("zh-CN", UI_RESOURCES["zh-CN"]);
  try {
    return { instance: initializeLocalInstance(usable), initialProblem };
  } catch {
    // A failed initialization is retained as an error, while an independently
    // initialized local baseline keeps Settings and its recovery usable.
    return { instance: initializeLocalInstance(UI_RESOURCES), initialProblem: new ResourceProblem("RESOURCE_INIT") };
  }
}

function initializeLocalInstance(usable: { en: unknown; "zh-CN": unknown }): i18n {
  const instance = createInstance();
  let initializationError: unknown;
  void instance.init({
    lng: "en", supportedLngs: ["en", "zh-CN"], load: "currentOnly",
    ns: ["ui"], defaultNS: "ui", fallbackLng: false, fallbackNS: false,
    initAsync: false, enableSelector: false, returnNull: false, returnEmptyString: false,
    interpolation: { escapeValue: false },
    resources: {
      en: { ui: structuredClone(usable.en) as typeof en },
      "zh-CN": { ui: structuredClone(usable["zh-CN"]) as typeof zhCN },
    },
    react: { useSuspense: false, bindI18n: "languageChanged", bindI18nStore: "added removed" },
  }, (error) => { initializationError = error; });
  if (initializationError != null || !instance.isInitialized) throw new ResourceProblem("RESOURCE_INIT");
  return instance;
}

export function restoreLocalBundle(instance: i18n, locale: UiLocale): void {
  validateBundle(locale, UI_RESOURCES[locale]);
  // Neither shallow nor deep addResourceBundle removes unexpected old keys.
  // Callers guard their own recovery notifications around this replacement.
  instance.removeResourceBundle(locale, "ui");
  instance.addResourceBundle(locale, "ui", structuredClone(UI_RESOURCES[locale]), true, true);
}
