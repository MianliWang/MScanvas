# Analysis workers

## Purpose

Future scientific packages should be isolated from the desktop host while sharing a typed MSCanvas module/run contract.

```text
Rust application core
  ├─ process supervision
  ├─ artifact/run registry
  ├─ parameter validation
  └─ event normalization
        │
        ├─ OpenMS TOPP command adapter
        └─ Python worker
             ├─ pyOpenMS
             ├─ matchms
             ├─ NumPy/SciPy/scikit-learn
             └─ reviewed domain packages
```

## Why out of process

- package crashes do not terminate the desktop UI;
- cancellation and resource limits remain enforceable;
- Python/package environments can be versioned and diagnosed separately;
- CLI/GUI/MCP can reuse the same execution contract;
- large artifacts can move by file/Arrow references rather than repeated JSON arrays.

## Initial protocol direction

No public plugin ABI yet. A first worker may use:

- JSON request/response metadata;
- JSON Lines events for progress/warnings/log references;
- paths/URIs for large inputs and outputs;
- Arrow/Parquet for tables where justified;
- explicit protocol and module versions.

## The first worker (M9.1)

One worker exists: the targeted MS1 recipe's fixed adapter
(`apps/desktop/src-tauri/src/targeted_ms1/adapter_v1.py`, embedded in the build)
in a fixed CPython 3.13.15 + pyOpenMS 3.5.0 runtime. What it settled:

- **Request and result:** one typed JSON request written by the supervisor, one
  result and one outcome file read back and validated field by field; JSON
  Lines progress events; rows and evidence as JSON Lines. No Arrow.
- **Supervision:** the shared process runner in `crates/proteowizard`
  (`CommandSpec::analysis_worker`), with a suspended spawn into a Job Object
  (kill-on-close, one active process, a memory cap, below-normal priority), a
  wall-clock budget, termination of the owned tree and an observed exit.
- **Identity:** the runtime is verified against a digest-pinned manifest before
  every launch, and the modules the worker reports loading are checked against
  it after.
- **Not enforced:** filesystem read confinement and network confinement.
  *2026-11-05:* the worker's Job now also refuses it new or switched desktops, display
  settings, exit Windows, global atoms, other processes' user handles, clipboard read
  and write and changes to system parameters, and an unhandled exception ends it with
  that exception's code instead of waiting on an error dialog; its environment sets
  `OPENMS_DISABLE_UPDATE_CHECK=1`. None of this stops a socket or a file read, so the
  line above stands ([ADR 0066 decision 7](adr/0066-analysis-runtime-release.md#7-confinement)).
- **Execution view (M9.3):** the worker is only ever given an ASCII name in its
  own attempt directory: a hard link to the held source on the work area's
  volume, or elsewhere a copy made in one read through the held handle and
  verified against the plan's bytes before launch. Attempt directories carry
  an owner marker and are swept only when their owner process is gone
  ([ADR 0049](adr/0049-content-bound-execution-snapshot.md)).
- **Batches (M9.4):** several acquisitions reviewed together still run one
  worker at a time, one acquisition per worker, in one loop inside one
  exclusive project job; no worker is ever given more than one acquisition
  ([ADR 0050](adr/0050-sequential-batch-of-independent-targeted-plans.md)).

The runtime is provisioned into a development checkout only; nothing here
satisfies the packaging gate below. See the
[M9.1 record](../product/M9_1_TARGETED_MS1_HANDOFF.md#m91-record), and the
[M9 closure](../product/M9_CLOSURE.md) for the current contract.

## Packaging gate

Before bundling a Python environment, evaluate download size, Windows installation, security updates, licenses, offline behavior and support cost. A user-managed environment can be an early development route but not an unexplained consumer requirement.

*2026-11-05:* [ADR 0066](adr/0066-analysis-runtime-release.md), accepted by the owner on that date and no wider than the owner's answers, answers this gate for the analysis runtime. It is not built, and it approves no shipping: its [list of what still blocks a release](adr/0066-analysis-runtime-release.md#what-still-blocks-a-release) stays open.
