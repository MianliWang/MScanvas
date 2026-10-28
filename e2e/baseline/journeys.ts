/**
 * The PM9.1 journey instrument: what a journey asks of a reader, counted by
 * the rules frozen in `docs/phases/pm9/baseline.md` §17.1.
 *
 * Version-neutral. A driver for one candidate supplies its selectors -- the
 * context it reads, the regions it names, the preserved set it compares --
 * and walks the journey through `step`. The before side (`d56b17b`) and
 * PM9.7's after side count the same things under the same names.
 *
 * Test-only. Nothing here judges a count; it records one.
 */

import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { cdp } from "../support/cdp";
import { consoleEntries, ipcCalls, type IpcCall } from "../support/harness";

export type StepKind = "step" | "decision" | "confirmation";

/** What a driver reads from the page after every step, by key. */
export type Context = Record<string, string | null>;

/** A candidate's selectors for the regions §17.1 names. */
export type Regions = Record<string, string>;

export interface Driver {
  readonly candidate: string;
  readonly regions: Regions;
  /** Surface, inspected object, open panels and dialogs, the main area's region. */
  context(): Promise<Context>;
}

/** §17.1's IPC classes. Raw per-command counts are kept beside them. */
const OTHER = new Set(["save_ui_preferences"]);
const READ_PREFIXES = ["get_", "read_", "preview_", "inspect_", "load_", "describe_"];
const READ = new Set(["project_selected_spectrum", "open_mzml_preview"]);

export function ipcClass(command: string): "read" | "work" | "other" {
  if (OTHER.has(command) || command.startsWith("subscribe_") || command.startsWith("unsubscribe_")) return "other";
  if (READ.has(command) || READ_PREFIXES.some((prefix) => command.startsWith(prefix))) return "read";
  return "work";
}

function tally(calls: readonly IpcCall[]) {
  const commands: Record<string, number> = {};
  const classes = { read: 0, work: 0, other: 0 };
  for (const call of calls) {
    commands[call.command] = (commands[call.command] ?? 0) + 1;
    classes[ipcClass(call.command)] += 1;
  }
  return { classes, commands };
}

async function frames() {
  await browser.execute(
    () => new Promise<void>((done) => requestAnimationFrame(() => requestAnimationFrame(() => done()))),
  );
}

/**
 * Counts insertions and removals of each named region's nodes from now on, by
 * node identity: a node inserted with a region inside it counts once per
 * region element it carries.
 */
async function watchMounts(regions: Regions) {
  await browser.execute((named: Record<string, string>) => {
    const target = window as unknown as Record<string, unknown>;
    const counts: Record<string, { mounted: number; unmounted: number }> = {};
    for (const name of Object.keys(named)) counts[name] = { mounted: 0, unmounted: 0 };
    const visit = (node: Node, key: "mounted" | "unmounted") => {
      if (!(node instanceof Element)) return;
      for (const [name, css] of Object.entries(named)) {
        const hits = (node.matches(css) ? 1 : 0) + node.querySelectorAll(css).length;
        counts[name]![key] += hits;
      }
    };
    const previous = target["__pm91Observer"] as MutationObserver | undefined;
    previous?.disconnect();
    const observer = new MutationObserver((records) => {
      for (const record of records) {
        record.addedNodes.forEach((node) => visit(node, "mounted"));
        record.removedNodes.forEach((node) => visit(node, "unmounted"));
      }
    });
    observer.observe(document.body, { childList: true, subtree: true });
    target["__pm91Observer"] = observer;
    target["__pm91Mounts"] = counts;
  }, regions);
}

async function readMounts(): Promise<Record<string, { mounted: number; unmounted: number }>> {
  return browser.execute(() =>
    JSON.parse(JSON.stringify((window as unknown as Record<string, unknown>)["__pm91Mounts"] ?? {})),
  ) as Promise<Record<string, { mounted: number; unmounted: number }>>;
}

export interface StepRecord {
  readonly index: number;
  readonly label: string;
  readonly kind: StepKind;
  readonly options: number | null;
  readonly dialog: boolean;
  readonly changes: readonly string[];
  readonly context: Context;
  readonly ipc: { readonly classes: Record<string, number>; readonly commands: Record<string, number> };
}

/**
 * One journey, walked. `start` is called once the page has mounted and the
 * journey's starting state is on screen; calls made before it are the
 * mount's, recorded apart.
 */
export class Journey {
  private readonly steps: StepRecord[] = [];
  private readonly preserved: Record<string, { before: unknown; after: unknown; kept: boolean }> = {};
  private mountCalls = 0;
  private mountTally: ReturnType<typeof tally> | null = null;
  private last: Context = {};
  private startedAt = 0;

  constructor(
    readonly name: string,
    readonly viewport: string,
    private readonly driver: Driver,
    private readonly output: string,
  ) {}

  async start(): Promise<void> {
    const calls = await ipcCalls();
    this.mountCalls = calls.length;
    this.mountTally = tally(calls);
    this.startedAt = calls.length;
    this.last = await this.driver.context();
    await watchMounts(this.driver.regions);
    await this.frame("00-start");
  }

  /**
   * One step: `action` performs the input and waits, on the page's own state,
   * for its outcome. `dialog` marks a step whose input is a native dialog's
   * answer, which the fixture stands in for.
   */
  async step(
    label: string,
    kind: StepKind,
    action: () => Promise<void>,
    options: { readonly options?: number; readonly dialog?: boolean } = {},
  ): Promise<void> {
    const before = (await ipcCalls()).length;
    await action();
    await frames();
    const after = await ipcCalls();
    const context = await this.driver.context();
    const changes = Object.keys({ ...this.last, ...context }).filter((key) => this.last[key] !== context[key]);
    this.last = context;
    const index = this.steps.length + 1;
    this.steps.push({
      index,
      label,
      kind,
      options: options.options ?? null,
      dialog: options.dialog === true,
      changes,
      context,
      ipc: tally(after.slice(before)),
    });
    await this.frame(`${String(index).padStart(2, "0")}-${label.replace(/[^a-z0-9]+/giu, "-").toLowerCase()}`);
  }

  /** Records one preserved-set entry: what it was before leaving, and after returning. */
  keep(key: string, before: unknown, after: unknown): void {
    this.preserved[key] = { before, after, kept: JSON.stringify(before) === JSON.stringify(after) };
  }

  private async frame(label: string) {
    const shot = await cdp("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
    if (typeof shot.data === "string") {
      writeFileSync(join(this.output, `${this.name}-${this.viewport}-${label}.png`), Buffer.from(shot.data, "base64"));
    }
  }

  /** The journey's record, in §17.1's terms. */
  async finish(endState: Record<string, unknown>) {
    const journeyCalls = (await ipcCalls()).slice(this.startedAt);
    const mounts = await readMounts();
    const changes: Record<string, number> = {};
    for (const step of this.steps) for (const key of step.changes) changes[key] = (changes[key] ?? 0) + 1;
    const ledger = await consoleEntries();
    return {
      journey: this.name,
      viewport: this.viewport,
      candidate: this.driver.candidate,
      totals: {
        steps: this.steps.length,
        decisions: this.steps.filter((step) => step.kind === "decision").length,
        confirmations: this.steps.filter((step) => step.kind === "confirmation").length,
        dialogs: this.steps.filter((step) => step.dialog).length,
        contextChanges: changes,
      },
      ipc: { mount: { calls: this.mountCalls, ...this.mountTally }, journey: tally(journeyCalls) },
      mounts,
      preserved: this.preserved,
      endState,
      steps: this.steps,
      console: ledger,
    };
  }
}
