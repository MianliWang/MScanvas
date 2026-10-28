/**
 * What each committed-range sentence claims, and when it is true (PM9 UI-34).
 *
 * One table for Chromatogram.test.tsx, SpectrumViewport.test.tsx and the PM9.3
 * browser spec, so every layer holds the same words to the same condition. It
 * is closed: a committed sentence missing here fails wherever it is rendered,
 * so new wording arrives with its truth condition. A sentence that claims to be
 * the range on screen fails while a held gesture shows another range.
 */

export interface RangeFacts {
  /** The committed range at the plot's precision (`fixed`), or `null` while the whole run or spectrum is committed. */
  readonly committed: string | null;
  /** The range the plot displays now, at the same precision: a held gesture's while one is held. */
  readonly shown: string;
}

export interface CommittedClaim {
  readonly en: string;
  readonly zh: string;
  readonly holds: (facts: RangeFacts) => boolean;
}

export const COMMITTED_CLAIMS: readonly CommittedClaim[] = [
  { en: "Committed {{name}}: full range", zh: "已提交 {{name}}：完整范围", holds: ({ committed }) => committed === null },
  // The owners store the whole run or spectrum as no commit, so every
  // committed range is a proper part of it, whatever the plot displays.
  { en: "Committed {{name}}: part of the full range", zh: "已提交 {{name}}：完整范围的一部分", holds: ({ committed }) => committed !== null },
  // Batch 2's sentence, kept so the checks know it is false while a held
  // gesture displays another range than the committed one.
  { en: "Committed {{name}}: the range shown", zh: "已提交 {{name}}：当前显示的范围", holds: ({ committed, shown }) => committed === shown },
];

/** A range at the plot's precision, as the committed line and the caption print it. */
export function fixed(domain: { readonly low: number; readonly high: number }): string {
  return `${domain.low.toFixed(4)} to ${domain.high.toFixed(4)}`;
}

/** Why a sentence on screen is not true of these facts, or `null` when it is. */
export function untrue(sentence: string, name: string, facts: RangeFacts, locale: "en" | "zh-CN" = "en"): string | null {
  const claim = COMMITTED_CLAIMS.find((each) => (locale === "en" ? each.en : each.zh).replace("{{name}}", name) === sentence);
  if (claim === undefined) return `no truth condition is declared for "${sentence}"`;
  return claim.holds(facts) ? null : `"${sentence}" is false: shown ${facts.shown}, committed ${facts.committed ?? "the whole source"}`;
}

/** The text under `root` outside every element inside it that `skip` matches, spaces collapsed. */
export function textOutside(root: Element, skip: string): string {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let text = "";
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const hidden = node.parentElement?.closest(skip);
    if (hidden === null || hidden === undefined || !root.contains(hidden)) text += node.textContent ?? "";
  }
  return text.replace(/\s+/gu, " ").trim();
}
