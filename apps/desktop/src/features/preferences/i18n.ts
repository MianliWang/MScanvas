import { createInstance, type i18n, type TFunction } from "i18next";

import { en } from "./locales/en";
import { zhCN } from "./locales/zh-CN";
import type { UiLocale } from "./sessionPreferences";

export const UI_RESOURCES = { en, "zh-CN": zhCN } as const;
export type MessageKey = Exclude<keyof typeof en, "rosterRows_one" | "rosterRows_other"> | "rosterRows";
export interface MessageParameters {
  readonly rosterRows: { readonly count: number };
  readonly resourceCode: { readonly code: string };
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

const simpleKeys = Object.keys(en).filter((key) => !key.startsWith("rosterRows_"));
const parameters = (message: string): string =>
  [...new Set([...message.matchAll(/\{\{\s*(\w+)(?:,\s*number)?\s*\}\}/gu)].map((match) => match[1]))].sort().join(",");

/** Required parameters at both the typed call site and the untyped boundary. */
export function bindUiMessages(t: TFunction<"ui">): UiMessage {
  return <K extends MessageKey>(key: K, ...args: MessageArguments<K>): string => {
    if (key !== "rosterRows" && !simpleKeys.includes(key)) throw new ResourceProblem("RESOURCE_KEYS", key);
    const values = args[0];
    if (key === "rosterRows") {
      if (values === undefined || !("count" in values) || !Number.isSafeInteger(values.count) || values.count < 0) {
        throw new ResourceProblem("RESOURCE_PARAMETERS", key);
      }
      return t("rosterRows", { count: values.count });
    }
    if (key === "resourceCode" || key === "unknownFigureProblem") {
      if (values === undefined || !("code" in values) || typeof values.code !== "string" || values.code.trim() === "") {
        throw new ResourceProblem("RESOURCE_PARAMETERS", key);
      }
      return key === "resourceCode" ? t("resourceCode", { code: values.code }) : t("unknownFigureProblem", { code: values.code });
    }
    return t(key as Exclude<MessageKey, keyof MessageParameters>);
  };
}

/** Exact locale coverage, before i18next fallback can obscure a missing value. */
export function validateBundle(locale: UiLocale, bundle: unknown): void {
  if (typeof bundle !== "object" || bundle === null || Array.isArray(bundle)) {
    throw new ResourceProblem("RESOURCE_MISSING");
  }
  const values = bundle as Record<string, unknown>;
  const plurals = new Intl.PluralRules(locale).resolvedOptions().pluralCategories;
  const expected = [...simpleKeys, ...plurals.map((plural) => `rosterRows_${plural}`)];
  if (Object.keys(values).some((key) => !expected.includes(key))) throw new ResourceProblem("RESOURCE_KEYS");
  for (const key of expected) {
    if (!(key in values)) throw new ResourceProblem("RESOURCE_MISSING", key);
    const value = values[key];
    if (typeof value !== "string" || value.trim() === "") throw new ResourceProblem("RESOURCE_EMPTY", key);
    const baseline = key.startsWith("rosterRows_") ? en.rosterRows_other : en[key as keyof typeof en];
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
