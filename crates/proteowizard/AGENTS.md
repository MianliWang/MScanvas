# ProteoWizard adapter guidance

This crate translates typed MSCanvas intent into validated ProteoWizard executable discovery and argv specifications.

- Never invoke a shell or construct a shell command string.
- Keep `msaccess` preview and `msconvert` conversion capabilities explicit.
- Do not silently change output format, centroiding behavior, filter order or backend.
- Normal UI concepts must map through typed semantic settings before becoming backend arguments.
- Preserve raw stdout/stderr for diagnostics but expose normalized failure categories upstream.
- Do not redistribute ProteoWizard or vendor components from this crate.
- Unit-test argv order, quoting independence and safety invariants with paths containing spaces and Unicode.

## mzML inspection and conversion integrity

- Process exit status, preview interpretation and conversion integrity are three separate judgements. Never derive one from another.
- The mzML scanner refuses any document type declaration and any general reference other than the five predefined entities and numeric character references. Never register an entity resolver.
- Never base64-decode and never decompress a binary array. Array point counts come from `defaultArrayLength`; keep the decompression-bomb class removed by construction rather than bounded.
- Every scan runs through the byte-counting reader and its explicit limits. A limit is a fail-closed error, never a truncation.
- Recognize controlled-vocabulary terms by accession, and scope them to the immediate parent element. An aggregate `fileContent` marker is not per-spectrum representation.
- Record facts; do not judge them in the scanner. A document that omits a schema-required attribute is reported through the facts and judged by the integrity comparison.
- A required invariant must be one a faithful conversion cannot violate. Anything the measured evidence shows `msconvert` can legitimately change stays advisory, and anything genuinely unestablishable becomes unverified rather than a failure.
- Never claim byte-for-byte equivalence, general losslessness or vendor fidelity, and never fail a conversion for a legal mzML serialization difference.
- Keep every new error and outcome variant free of paths and raw backend text, give it a stable identifier, and keep raw scientific identifiers out of debug projections.

## RT × m/z map (ADR 0068, proposed)

- `rt_mz_map.rs` reads MS1 spectra only through the viewing reader's selected read, at the table's offsets, over one handle per pass, and decodes nothing itself. Its one computation over the arrays is ADR 0068's: the greatest stored intensity per cell. Add no other without a record.
- An empty cell is not zero. Nothing is smoothed, centroided, interpolated or converted between units; mixed units refuse the map, a refused spectrum refuses the whole map, and a cancelled pass returns no raster.

## mzML viewing reader (ADR 0056)

- `mzml_reader.rs` is the only module that base64-decodes or inflates an array, and only the m/z and intensity arrays of one selected spectrum. The inspector above stays decode-free.
- It reuses the inspector's byte-counting reader, limits and `DOCTYPE`/entity refusal. Resolve element names by namespace, never by literal qualified name.
- Check the decode caps before reserving anything, with checked arithmetic, and reserve with `try_reserve_exact`. Inflate into the declared length + 1 and refuse overrun and underrun.
- Every refusal is typed and scoped: the open, or one selected spectrum. Never skip, guess, fall back to `msaccess`, or compute from the arrays.
