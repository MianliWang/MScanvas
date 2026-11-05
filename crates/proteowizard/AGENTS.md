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

## RT × m/z map (ADR 0068, accepted 2026-11-03)

- `rt_mz_map.rs` reads MS1 spectra only through the viewing reader's selected read, at the table's offsets, over one handle per pass, and decodes nothing itself. Its one computation over the arrays is ADR 0068's: the greatest stored intensity per cell. Add no other without a record.
- An empty cell is not zero. Nothing is smoothed, centroided, interpolated or converted between units; mixed units refuse the map, a refused spectrum refuses the whole map, and a cancelled pass returns no raster.
- A map is of one polarity and one representation. A file where only some MS1 spectra declare one has no map; a file where none do does not separate by it, and each of its maps states it as not reported (as built 2026-11-04, not an owner decision).
- An MS1 spectrum that declares a narrow scan (MAP-1.9) is on no map, is never read for one, and is counted. Narrow is read as stating `zoom scan` (MS:1000497) or `SIM spectrum` (MS:1000582), a reading, not an owner decision. A numeric definition of narrow is open (ADR 0068 decision 1). Until one is decided, do not derive it from a width or a scan window, and do not read the filter string (R-1-ANALYZER, section 1e).

## mzML viewing reader (ADR 0056)

- `mzml_reader.rs` is the only module that base64-decodes or inflates an array, and only the m/z and intensity arrays of one selected spectrum. There are two exceptions to "one selected spectrum". The first is the XIC pass in `mzml_xic.rs`, the computation ADR 0071 records under ADR 0070: through this module's primitives it decodes those arrays of every spectrum it evaluates, in one streaming pass in source order, one spectrum's arrays at a time, and keeps only its per-scan result. The second is the map pass in `rt_mz_map.rs`, the computation ADR 0068 records under ADR 0070: through the selected read, at the table's offsets, it decodes those arrays of the MS1 spectra of one map inside its window, one spectrum's arrays at a time, and keeps only its raster. Any other decode stays forbidden until an accepted record under ADR 0070 names it and its slice changes this line. The inspector above stays decode-free.
- It reuses the inspector's byte-counting reader, limits and `DOCTYPE`/entity refusal. Resolve element names by namespace, never by literal qualified name.
- Check the decode caps before reserving anything, with checked arithmetic, and reserve with `try_reserve_exact`. Inflate into the declared length + 1 and refuse overrun and underrun.
- Every refusal is typed and scoped: the open, or one selected spectrum. Never skip, guess, fall back to `msaccess`, or compute from the arrays. There are two exceptions to "compute from the arrays". The first is the XIC pass in `mzml_xic.rs`, which computes the one quantity ADR 0071 records under ADR 0070: the per-scan sum of stored intensities whose m/z lies in a closed window. It applies ADR 0046's per-scan state policy, not the reader's viewing refusals, so the scope above is not its scope. The second is the map pass in `rt_mz_map.rs`, which computes the one quantity ADR 0068 records under ADR 0070: the greatest stored intensity per cell of a bounded raster. It reads through the selected read, so the reader's refusals and the scope above do apply to each spectrum, and one refused spectrum refuses the whole map. Any other computation stays forbidden until an accepted record under ADR 0070 names it and its slice changes this line.
- Polarity, charge and the run-level metadata are read without refusing (the 2026-10-30 note in ADR 0056). Keep them out of `Term`, whose restatement refuses the open, and out of the shared attribute capture. A polarity or charge stated two ways or unreadably is not reported; metadata parameters are carried as stated and never judged, an accession that is not `PREFIX:ID` is not reported, and metadata over its bound is not reported at all.
- Whether a spectrum declares a narrow scan is read the same way (the 2026-11-05 note in ADR 0056), on the spectrum or its scan, unlike polarity. Keep its terms out of `fact`, which the XIC pass shares.
