# Core domain guidance

This crate owns stable product concepts and invariants. It must not depend on Tauri, React, shell syntax or a concrete scientific backend.

- Prefer explicit enums and small value types over strings and loosely typed maps.
- Model workspace items, artifacts, runs and semantic settings separately from backend commands.
- Preserve forward migration paths with versioned serialized contracts only when they are actually persisted or public.
- Keep filesystem/process behavior outside this crate unless it is a pure path/domain rule.
- Unit-test every safety and state-transition invariant.
