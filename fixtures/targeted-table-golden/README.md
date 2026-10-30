# Targeted results table golden fixtures

`results.csv` and `results.tsv` are the exact bytes `result_table` writes for
the stored targeted MS1 result `golden_stored()` builds in
`apps/desktop/src-tauri/src/targeted_ms1/tests.rs`, pinned by
`the_csv_and_tsv_tables_are_byte_for_byte_what_they_were`.

They exist for ADR 0054. They were generated before the spreadsheet variant
existed, with `project/targeted_output.rs` as it was on `main`, so they show
that the variant changes neither document. Do not regenerate them for the
variant: a difference in them is a change to the CSV or TSV contract of ADR
0048 section 5.

`golden_stored()` is built from literals only: fixed identifiers and digests,
no store and no digest of this build's recipe, so the bytes depend on the table
writer alone. Its text includes values that start with `=`, `+`, `-` and `@`,
and a label holding `;` before each of them, to show that CSV and TSV write
such values exactly as stored. Every value is one TSV can carry: no tab and no
line break.

`results-spreadsheet.csv` is the spreadsheet CSV of the same result, pinned by
`the_spreadsheet_csv_is_its_golden_document_after_one_byte_order_mark`. The
file holds the text **after** the byte-order mark: the test asserts the mark
separately (`EF BB BF`, once, first), so an editor that adds or strips one
cannot change what is compared without the test failing. Against `results.csv`
it differs in exactly the `#format` value and the apostrophes ADR 0054 adds to
the declared text fields.

Regenerating a fixture means writing what the test's call returns; there is no
separate tool, because the test is the specification of what the file holds.
