# Saved figure golden documents

`linked-full-run.msfigure` is the exact document this build writes when the
linked golden figure (`../plot-golden/linked-full-run.svg`) is saved
([ADR 0062](../../docs/architecture/adr/0062-saved-figurespec.md)). It is
pinned by `the_pinned_document_is_written_and_reopened` in
`apps/desktop/src-tauri/src/preview/saved_figure/tests.rs`, which checks two
things:

- saving that figure writes these bytes, so a change to the wire shape is a
  visible decision rather than a silent one; and
- this document, placed beside a source holding the test's `SOURCE` bytes,
  still reopens to `linked-full-run.svg`, so a later build that can no longer
  read what this one saved fails.

The source it names is `run.mzML` beside the document. Its baseline is the
length and SHA-256 of the test's stand-in bytes, not of a real acquisition;
the test's fixed reader supplies the spectrum table and the scan. The
`dataSha256` is the digest of the data the linked golden figure draws, and
`documentSha256` seals the rest.

Regenerating it means saving that case and writing the result. A change here
is a change to the saved-figure format: it needs a new `formatVersion` unless
the old documents still read.
