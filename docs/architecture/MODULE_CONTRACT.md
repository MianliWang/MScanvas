# Analysis module contract

Status: design boundary for future work; no generic plugin system is implemented.

A supported module should declare:

```text
id and semantic version
human name and scientific purpose
provider/backend and version requirements
compatible artifact input types and cardinality
parameter schema, units, defaults and risk/warnings
output artifact schemas
estimated resource profile when available
progress/cancellation capabilities
validation and known limitations
```

## Execution lifecycle

1. Resolve compatible selected inputs.
2. Validate parameters and environment.
3. Produce a reviewable resolved invocation.
4. Execute through an approved provider/executor.
5. Normalize events and failures.
6. Validate/register result artifacts.
7. Persist lineage and expose compatible views/actions.

## UI rules

- Normal mode describes scientific intent; package-specific names can appear in details/provenance.
- Defaults are not “magic”: explain effects, units and destructive/lossy transformations.
- Curated recipes can compose modules without exposing a graph.
- Advanced workflow editing comes only after repeated user evidence.

## Security rules

- Modules cannot expose arbitrary shell text as a parameter.
- Read/write locations are resolved by the host.
- Environment variables and secrets are allow-listed and redacted.
- Third-party code/license/version provenance is visible.
