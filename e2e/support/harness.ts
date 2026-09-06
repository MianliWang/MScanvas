/**
 * The rendered-QA harness: one IPC boundary, one console ledger, one ruler.
 *
 * The Tauri service gives this run browser mode — the real frontend in real
 * Chrome against the real Vite dev server. What it does not give is control
 * over *when* the mock table exists, and this application asks its backend
 * questions in a mount effect: the roster, the backend verdict, the conversion
 * slot. A table registered after navigation is a table that arrives late, so
 * the boundary here is installed as a preload script instead, before any page
 * script runs.
 *
 * It is still the IPC boundary and nothing else. `window.__TAURI_INTERNALS__
 * .invoke` is what `@tauri-apps/api/core` calls; nothing about React, the hook,
 * or the components is stubbed, so what these tests drive is the shipped
 * frontend.
 */

/** The per-document secret Rust installs before any script runs. */
const DOCUMENT_AUTHORITY = "0123456789abcdef0123456789abcdef";

/** Where the browser-side ledger of invocations lives. */
const CALL_LOG = "__mscanvasIpcCalls__";

/** Where the browser-side answer table lives. */
const TABLE = "__mscanvasIpcTable__";

/**
 * Where the answer table lives on `window`.
 *
 * Exported so a spec can build a very large answer *in the page* rather than
 * shipping it through an init script. A 36,319-row spectrum table is megabytes
 * of JSON; generating it where it is used keeps the driver payload small and
 * the fixture deterministic.
 */
export const IPC_TABLE_KEY = TABLE;

/** Where the browser-side console ledger lives. */
const CONSOLE_LOG = "__mscanvasConsole__";

/**
 * Where the set of commands whose answers are being withheld lives.
 *
 * A rendered claim about what the interface says *during* a backend operation
 * cannot be made against a boundary that answers in the same microtask: the
 * window never exists on screen. Holding a command keeps its callers waiting
 * until the test releases them, which is the only way to look at a settings read
 * in progress, a backend check in flight, or a queue that has not settled.
 */
const HELD = "__mscanvasIpcHeld__";

/** Where the callers waiting on a held command live. */
const PENDING = "__mscanvasIpcPending__";

export interface IpcCall {
  readonly command: string;
  readonly args: Record<string, unknown>;
}

export interface ConsoleEntry {
  readonly level: string;
  readonly text: string;
}

/**
 * Installs the boundary for every document this session loads.
 *
 * Registered once per session as a preload script, so a reload keeps it. The
 * answer table is seeded here and replaced per test through
 * {@link setInvokeResult}.
 *
 * `hold` withholds the named commands' answers from the very first document
 * script, which is the only way to hold something this application asks for in
 * a mount effect: a hold installed after navigation races the request it means
 * to catch, and loses whenever the machine is quick.
 */
export async function installIpcBoundary(
  table: Record<string, unknown>,
  options: { readonly hold?: readonly string[] } = {},
): Promise<void> {
  await browser.addInitScript(
    (
      authority: string,
      callLog: string,
      tableKey: string,
      consoleLog: string,
      // The answer table and the two hold ledgers' keys, in one payload.
      // `addInitScript` takes the callback plus at most five arguments, and
      // these always travel together anyway.
      seeded: string,
    ) => {
      const seed = JSON.parse(seeded) as {
        table: Record<string, unknown>;
        held: string;
        pending: string;
        hold: string[];
      };
      const heldKey = seed.held;
      const pendingKey = seed.pending;
      const target = window as unknown as Record<string, unknown>;
      target["__MSCANVAS_DOCUMENT_AUTHORITY__"] = authority;
      target[callLog] = [];
      target[tableKey] = seed.table;
      target[consoleLog] = [];
      target[heldKey] = Object.fromEntries(seed.hold.map((command) => [command, true]));
      target[pendingKey] = {};

      // The console ledger. Captured by patching rather than by reading a
      // driver log, so an entry can be attributed to a level and read back
      // verbatim -- and so an unhandled rejection, which no console method
      // reports, lands in the same place as everything else.
      const record = (level: string, args: unknown[]) => {
        (target[consoleLog] as { level: string; text: string }[]).push({
          level,
          text: args
            .map((value) => {
              try {
                return typeof value === "string" ? value : JSON.stringify(value);
              } catch {
                return String(value);
              }
            })
            .join(" "),
        });
      };
      for (const level of ["error", "warn"] as const) {
        const original = console[level].bind(console);
        console[level] = (...args: unknown[]) => {
          record(level, args);
          original(...args);
        };
      }
      window.addEventListener("unhandledrejection", (event) => {
        record("unhandledrejection", [String(event.reason)]);
      });
      window.addEventListener("error", (event) => {
        record("uncaught", [String(event.message)]);
      });

      // The boundary itself. An unmocked command throws rather than resolving
      // to undefined: a command this run has not accounted for is a gap in the
      // harness, and answering it quietly would hide the gap.
      const internals = {
        invoke: (command: string, args: Record<string, unknown>) => {
          (target[callLog] as { command: string; args: unknown }[]).push({ command, args });
          // **Held before anything else, including the unmocked check.** A hold
          // names a command explicitly, which is exactly the thing the unmocked
          // rejection exists to detect the absence of -- and the two commands
          // worth holding longest are the ones with no answer at all: an open
          // native picker, and a read the test means never to complete.
          //
          // The caller is parked until the test releases it, and the answer it
          // finally gets is whatever the table says *then*, so a test can hold a
          // read, change what it would answer, and release it.
          const held = target[heldKey] as Record<string, boolean>;
          if (held[command] === true) {
            const pending = target[pendingKey] as Record<string, ((value: unknown) => void)[]>;
            pending[command] = pending[command] ?? [];
            return new Promise((settle) => {
              pending[command]!.push(settle);
            });
          }
          const answers = target[tableKey] as Record<string, unknown>;
          if (!(command in answers)) {
            return Promise.reject(new Error(`no mocked answer for ${command}`));
          }
          const answer = answers[command];
          if (answer !== null && typeof answer === "object" && "__reject" in answer) {
            return Promise.reject((answer as { __reject: unknown }).__reject);
          }
          return Promise.resolve(answer);
        },
        transformCallback: (callback: unknown) => callback,
        unregisterCallback: () => undefined,
        convertFileSrc: (path: string) => path,
      };
      target["__TAURI_INTERNALS__"] = internals;
    },
    DOCUMENT_AUTHORITY,
    CALL_LOG,
    TABLE,
    CONSOLE_LOG,
    JSON.stringify({ table, held: HELD, pending: PENDING, hold: [...(options.hold ?? [])] }),
  );
}

/**
 * Withholds one command's answer until {@link releaseInvokeHold} is called.
 *
 * Every caller that arrives while the hold stands is parked; the window the
 * interface renders during that operation is what the hold exists to make
 * observable. Callers that arrive *before* the hold are already answered.
 */
export async function holdInvoke(command: string): Promise<void> {
  await browser.execute(
    (heldKey: string, name: string) => {
      const target = window as unknown as Record<string, Record<string, boolean>>;
      target[heldKey]![name] = true;
    },
    HELD,
    command,
  );
}

/**
 * Answers everyone waiting on a held command, and stops holding it.
 *
 * The answer is read from the table at release time rather than at call time,
 * so a test may change what the command would say while its callers are parked.
 */
export async function releaseInvokeHold(command: string): Promise<void> {
  await browser.execute(
    (heldKey: string, pendingKey: string, tableKey: string, name: string) => {
      const target = window as unknown as Record<string, Record<string, unknown>>;
      (target[heldKey] as Record<string, boolean>)[name] = false;
      const pending = target[pendingKey] as unknown as Record<
        string,
        ((value: unknown) => void)[]
      >;
      const waiting = pending[name] ?? [];
      pending[name] = [];
      const answer = (target[tableKey] as Record<string, unknown>)[name];
      for (const settle of waiting) {
        settle(answer);
      }
    },
    HELD,
    PENDING,
    TABLE,
    command,
  );
}

/** How many callers are currently parked on a held command. */
export async function heldCallers(command: string): Promise<number> {
  return browser.execute(
    (pendingKey: string, name: string) =>
      ((window as unknown as Record<string, Record<string, unknown[]>>)[pendingKey]?.[name] ?? [])
        .length,
    PENDING,
    command,
  ) as Promise<number>;
}

/** Replaces one command's answer for the remainder of the current document. */
export async function setInvokeResult(command: string, answer: unknown): Promise<void> {
  await browser.execute(
    (tableKey: string, name: string, value: string) => {
      const target = window as unknown as Record<string, Record<string, unknown>>;
      target[tableKey][name] = JSON.parse(value) as unknown;
    },
    TABLE,
    command,
    JSON.stringify(answer),
  );
}

/** Makes one command reject, so a typed refusal can be rendered. */
export async function setInvokeRejection(command: string, error: unknown): Promise<void> {
  await setInvokeResult(command, { __reject: error });
}

/** Every invocation this document has made, in order. */
export async function ipcCalls(): Promise<IpcCall[]> {
  return browser.execute(
    (callLog: string) => (window as unknown as Record<string, IpcCall[]>)[callLog],
    CALL_LOG,
  ) as Promise<IpcCall[]>;
}

/** Every console entry and unhandled failure this document has produced. */
export async function consoleEntries(): Promise<ConsoleEntry[]> {
  return browser.execute(
    (key: string) => (window as unknown as Record<string, ConsoleEntry[]>)[key],
    CONSOLE_LOG,
  ) as Promise<ConsoleEntry[]>;
}

/**
 * Warnings this repository already produces, and which M4.1 did not introduce.
 *
 * Narrow by construction and matched as substrings of the whole entry. A blanket
 * ignore would make the console gate worthless; an empty list would make it fail
 * on something this milestone is not responsible for.
 */
export const ALLOWED_CONSOLE_SUBSTRINGS: readonly string[] = [
  // React Router / dev-server noise has no place here yet; the list starts
  // empty on purpose and grows only with a named, justified entry.
];

/** One element's box, in CSS pixels relative to the viewport. */
export interface Box {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  readonly width: number;
  readonly height: number;
}

/** Reads one element's bounding rectangle. */
export async function boxOf(selector: string): Promise<Box> {
  const element = await $(selector);
  await element.waitForExist({ timeout: 10_000 });
  return browser.execute((css: string) => {
    const node = document.querySelector(css);
    if (node === null) {
      throw new Error(`no element for ${css}`);
    }
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }, selector) as Promise<Box>;
}

/** Reads the bounding rectangle of one element found by accessible name. */
export async function boxOfButton(name: string): Promise<Box> {
  return browser.execute((label: string) => {
    const node = [...document.querySelectorAll("button")].find(
      (candidate) => candidate.textContent?.trim() === label,
    );
    if (node === undefined) {
      throw new Error(`no button labelled ${label}`);
    }
    const rect = node.getBoundingClientRect();
    return {
      left: rect.left,
      right: rect.right,
      top: rect.top,
      bottom: rect.bottom,
      width: rect.width,
      height: rect.height,
    };
  }, name) as Promise<Box>;
}

/**
 * Whether one box is wholly inside another, within a sub-pixel tolerance.
 *
 * Layout arithmetic produces fractional pixels that no reader can see, so an
 * exact comparison would fail on a figure nothing is wrong with. Half a pixel
 * is well below anything a clipped control could hide in.
 */
export function contains(outer: Box, inner: Box, tolerance = 0.5): boolean {
  return (
    inner.left >= outer.left - tolerance &&
    inner.right <= outer.right + tolerance &&
    inner.top >= outer.top - tolerance &&
    inner.bottom <= outer.bottom + tolerance
  );
}

/** The accessible name of whatever currently has focus. */
export async function focusedName(): Promise<string> {
  return browser.execute(() => {
    const active = document.activeElement;
    if (active === null) {
      return "";
    }
    return (active.textContent ?? "").trim();
  }) as Promise<string>;
}

/** The tag of whatever currently has focus. */
export async function focusedTag(): Promise<string> {
  return browser.execute(() => document.activeElement?.tagName ?? "") as Promise<string>;
}

/**
 * Whether the focused element is actually given a visible focus treatment.
 *
 * Read from computed style rather than from the presence of a `:focus` rule,
 * because a rule that exists and is overridden is a rule nobody can see. An
 * outline with a width, or a ring drawn as a box shadow, both count.
 */
export async function focusedTreatment(): Promise<{
  readonly outlineWidth: string;
  readonly outlineStyle: string;
  readonly boxShadow: string;
  readonly visible: boolean;
}> {
  return browser.execute(() => {
    const active = document.activeElement;
    if (active === null) {
      return { outlineWidth: "", outlineStyle: "none", boxShadow: "none", visible: false };
    }
    const style = getComputedStyle(active);
    const outlineWidth = style.outlineWidth;
    const outlineStyle = style.outlineStyle;
    const boxShadow = style.boxShadow;
    const outlined = outlineStyle !== "none" && Number.parseFloat(outlineWidth) > 0;
    const ringed = boxShadow !== "none" && boxShadow.trim() !== "";
    return { outlineWidth, outlineStyle, boxShadow, visible: outlined || ringed };
  }) as Promise<{
    outlineWidth: string;
    outlineStyle: string;
    boxShadow: string;
    visible: boolean;
  }>;
}

/** Whether the document scrolls sideways at the current viewport. */
export async function horizontalOverflow(): Promise<{
  readonly scrollWidth: number;
  readonly innerWidth: number;
}> {
  return browser.execute(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    innerWidth: window.innerWidth,
  })) as Promise<{ scrollWidth: number; innerWidth: number }>;
}
