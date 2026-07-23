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

## Packaging gate

Before bundling a Python environment, evaluate download size, Windows installation, security updates, licenses, offline behavior and support cost. A user-managed environment can be an early development route but not an unexplained consumer requirement.
