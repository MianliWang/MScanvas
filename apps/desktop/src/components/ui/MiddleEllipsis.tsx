import { cx } from "./shared";

/** Names up to this length fit every column they are shown in. */
const SHORT = 24;

/** Where a name splits: its last few characters and its extension stay whole. */
export function middleSplit(text: string, keep = 8): readonly [string, string] {
  const dot = text.lastIndexOf(".");
  const tail = Math.max(0, (dot > 0 ? dot : text.length) - keep);
  return [text.slice(0, tail), text.slice(tail)];
}

/**
 * One line that loses characters from its middle, never its end, so a file
 * name keeps its extension and its distinguishing suffix. The whole name is
 * the tooltip and is read as one string.
 */
export function MiddleEllipsis({ text, className }: { readonly text: string; readonly className?: string }) {
  const [head, tail] = middleSplit(text);
  // A short name is one text node: nothing in it is worth splitting.
  if (text.length <= SHORT) return <span className={cx("ui-middle-ellipsis", className)} title={text}>{text}</span>;
  return <span className={cx("ui-middle-ellipsis", className)} title={text}>
    <span className="ui-middle-ellipsis__head">{head}</span><span className="ui-middle-ellipsis__tail">{tail}</span>
  </span>;
}
