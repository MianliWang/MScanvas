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

The runtime is provisioned into a development checkout only; nothing here
satisfies the packaging gate below. See the
[M9.1 record](../product/M9_1_TARGETED_MS1_HANDOFF.md#m91-record).

## Packaging gate

Before bundling a Python environment, evaluate download size, Windows installation, security updates, licenses, offline behavior and support cost. A user-managed environment can be an early development route but not an unexplained consumer requirement.
