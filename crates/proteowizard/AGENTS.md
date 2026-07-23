# ProteoWizard adapter guidance

This crate translates typed MSCanvas intent into validated ProteoWizard executable discovery and argv specifications.

- Never invoke a shell or construct a shell command string.
- Keep `msaccess` preview and `msconvert` conversion capabilities explicit.
- Do not silently change output format, centroiding behavior, filter order or backend.
- Normal UI concepts must map through typed semantic settings before becoming backend arguments.
- Preserve raw stdout/stderr for diagnostics but expose normalized failure categories upstream.
- Do not redistribute ProteoWizard or vendor components from this crate.
- Unit-test argv order, quoting independence and safety invariants with paths containing spaces and Unicode.
