# ADR 0053 — PNG text metadata

Status: **Accepted**, by the owner's decisions of 2026-10-28
([after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), section 2 and
section 6.3, FIG-002).
Related: [0028](0028-figure-renderer-and-semantic-specification.md) (the
renderer and the semantic specification),
[0030](0030-png-copy-plot-and-figure-settings.md) (PNG, `Copy plot` and figure
settings), [0036](0036-linked-chromatogram-spectrum-figure.md) (the linked
figure), [0048](0048-stored-targeted-result-reuse-and-export.md) (stored
targeted results).

## Context

Every figure MSCanvas saves is one `FigureSpec` drawn by one deterministic SVG
renderer. The SVG carries an accessible `<title>` and `<desc>`: the user's
title or a derived one, then the description with the figure's disclosures
(scope, representation, units, reductions, anything the page had no room for)
and any caption. A PNG is that SVG on a pixel grid (ADR 0030). Until now it
carried the pixels and `pHYs`, and nothing else. So the words that tell a
reader what the figure is, and what it does not claim, were lost as soon as the
figure was saved as PNG, the format most often pasted into slides, notebooks
and manuscripts.

PNG has a standard place for those words. The specification's text chunks hold
keyword and value pairs, and `Title` and `Description` are two of its
predefined keywords. Image viewers, file managers and metadata tools read them.

The owner selected the feature on 2026-10-28, as part of the post-beta-1 work,
and accepted the recommended design defaults.

## Decisions

### 1. Two uncompressed `iTXt` chunks, `Title` and `Description`

Every saved PNG figure gains exactly two text chunks, in this order:

| Keyword | Value |
| --- | --- |
| `Title` | the text of the SVG's `<title>` |
| `Description` | the text of the SVG's `<desc>` |

Both are `iTXt`, UTF-8, **uncompressed** (compression flag 0, method 0), with
an empty language tag and an empty translated keyword. No `tEXt` or `zTXt`
chunk is written.

### 2. Exactly the SVG's own words, from the same renderer call

`mscanvas_plot_spec::svg::render_with_text` returns the SVG document together
with the text of its `<title>` and `<desc>`. The PNG takes both from that one
call, and rasterizes the document from the same call. The values are the text
before XML escaping, which is what an XML reader gets back from the SVG: a
quotation mark is `"`, not `&quot;`.

The text is not built again in the desktop crate, because a second derivation
could disagree with the first. The description depends on layout (for example
the sentence saying a title was too long to print as a heading), so only the
renderer knows the final words.

`svg::render` is `render_with_text(..).svg`. **The SVG's bytes do not change.**
The golden documents in `fixtures/plot-golden` pin this for every figure kind:
the spectrum and the chromatogram already had goldens, and the linked figure
and a stored targeted result gained theirs. Both were rendered on `main` before
the accessor existed.

### 3. Only those two keys

- **No machine-readable provenance key.** No serialized `FigureSpec`, schema
  version, digest, `Software`, `Source` or `Creation Time` key. A creation
  time would also break the determinism ADR 0030 claims. A saved figure
  specification is its own feature (FIG-007).
- **No path or handle, as for the SVG.** The PNG carries nothing the SVG does
  not. A stored targeted result's caption already names its result and plan
  identifiers (ADR 0048), so its `Description` does too, as the same words.

### 4. Every saved PNG, and nothing else

- **In scope:** every PNG written to a file: the selected spectrum, the
  chromatogram, the linked figure, a stored targeted result's figure, and the
  publication-size PNG once it is wired. They all go through one function in
  `preview/export.rs`.
- **Unchanged:** `Copy plot`, whose clipboard image is RGBA with nowhere to put
  text (ADR 0030); TIFF; SVG; the data documents.
- **No UI.** There is no setting, toggle or preview of the chunks.

### 5. No dependency change

The pinned encoder, `png = "=0.18.1"`, writes `iTXt` with
`Encoder::add_itxt_chunk`, uncompressed, at its current version and features.
The chunks go before the image data. Nothing is added to `Cargo.lock`.

### 6. Disclosure

The change is stated in the changelog's unreleased section and, when the next
release is prepared, in its release notes. A PNG now carries the figure's
labels: a target label the user typed, a stored result's identifiers and,
once a figure title can be typed, that title can be read from the file
without opening the image.

## Alternatives rejected

- **`tEXt`.** It is Latin-1 only. A Chinese target label or the em dash in a
  stored result's title cannot be written, and transcoding or dropping it would
  make the PNG disagree with the SVG.
- **`zTXt` or compressed `iTXt`.** Uncompressed text can be read without
  inflating anything. A description is a few hundred bytes, so compression
  saves almost nothing.
- **A provenance key.** Not selected by the owner. It would be a machine
  contract to version, and it would put more in the PNG than the SVG carries.
- **XMP or `eXIf`.** Heavier, and either one needs a second serialization of
  the same two strings.
- **Text in `Copy plot`.** The clipboard image has no metadata (ADR 0030).
- **A user toggle.** No interface was decided. The text is the figure's own
  accessible text, so the PNG simply keeps it, as the SVG does.

## Consequences

- A saved PNG says what it is, and what it does not claim, to any tool that
  reads PNG text, in the same words as the SVG.
- A PNG saved by this version differs in bytes from one saved by beta 1 for
  the same figure. Its pixel data is identical. Tests per figure kind parse the
  raw chunks and check that:
  - exactly two text chunks are written, both uncompressed `iTXt`;
  - their keys are `Title` and `Description`;
  - their values equal the SVG's unescaped `<title>` and `<desc>`, including
    non-ASCII text;
  - the decoded pixels equal the `Copy plot` raster;
  - removing the two chunks leaves exactly the bytes the encoder wrote before
    this decision.
- A file grows by the length of its two strings.
- The native suites' PNG readers walk every chunk and are unaffected. A native
  read-back of a file the installed application wrote is still to come, with
  the rest of this feature's records.

## What this amends

- [ADR 0030](0030-png-copy-plot-and-figure-settings.md): a PNG carries `pHYs`
  and, from this decision, the two text chunks (dated note under `pHYs`).
- [The figure model](../FIGURE_MODEL.md), the M4.2 table;
  [the feature catalog](../../product/FEATURE_CATALOG.md), FIG-002; and
  [the after-beta-1 plan](../../development/AFTER_BETA1_PLAN.md), section 6.3.
