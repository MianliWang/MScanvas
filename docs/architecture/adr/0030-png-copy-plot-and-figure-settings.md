# ADR 0030 — PNG, Copy plot, and figure settings

Status: accepted (M4.2)

Supersedes nothing. Extends [ADR 0028](0028-figure-renderer-and-semantic-specification.md),
which settled the semantic figure contract, and
[ADR 0029](0029-first-visible-spectrum-figure-and-data-export.md), which made the
first figure user-reachable.

## Context

M4.1 shipped one figure format and one data pair: SVG, CSV, TSV, at a fixed size
and a fixed theme, for the selected spectrum. It left three things open that this
milestone closes — a raster format, a way to put a figure somewhere other than a
file, and the ability to choose what the figure looks like — and one thing it
deferred, which had to be closed first.

## The snapshot lifecycle, closed

M4.1 Round 2 established that the export slot retained the complete spectrum
longer than its own contract claimed. The slot holds "the spectrum the loaded
panel names"; installing a newer one replaced it, but every *other* way a panel
stops naming one left two `f64` arrays alive with nothing on screen pointing at
them. The harmful export was unreachable — the panel renders no export control
unless a spectrum is loaded — but retention is not what the sentence said, and
M4.2 adds three more consumers of the same snapshot.

Revocation is now Rust's decision, taken where the event happens, rather than a
courtesy the webview is trusted to perform. Six paths close it:

- a read that answers `Unavailable`, and a read that fails at all, both through
  one wrapper around the interpretation rather than a branch each — so the next
  branch somebody adds cannot quietly keep a spectrum alive;
- removing the dataset the spectrum came from;
- clearing the list;
- opening a preview, which takes the current one off the screen before it can
  succeed or fail;
- **choosing another file through the single-file picker**, which replaces the
  whole selection without going through the clear path. This one was not on the
  list when the work began; it was found while writing the tests, and it is the
  reason the list is enforced in Rust rather than remembered;
- installing a replacement, which already dropped the previous one.

### `DatasetId`, and what it is not

Deciding whether a removal owns the retained spectrum needs an identity the slot
did not have, so the snapshot now carries the `DatasetId` it was read from.

That is a number this session allocated. Only Rust can turn one into a path, and
it does so against a registry that revalidates the file every time — so carrying
it here adds no way to learn where anything is. It is never serialized, never
sent to the webview, and never written down. It exists to answer exactly one
question: is this one of the rows going away.

The question matters in both directions. Removing an *unrelated* row must not
revoke the spectrum a user is reading — the frontend deliberately keeps the
preview open in that case — and neither must moving keyboard focus to a vendor
row, which reaches no command that changes the selection. Both have their own
tests.

### What revocation does and does not end

A claimed export is untouched. It holds its own `Arc` and finishes, which the
tests assert by clearing the list mid-export and then writing the file. What
revocation ends is narrower and is the whole point: afterwards the old token
names nothing, so every *new* operation is refused as stale.

### Evidence that the memory is released

Every lifecycle test asserts two different claims, kept separate on purpose:

- the old token is refused, which proves the slot stopped **naming** the
  spectrum;
- a `std::sync::Weak` fails to upgrade, which proves the arrays were
  **released**.

Only the second is what the retention was about. Each of the six revocation
points was checked by removing it and watching the tests fail.

### One refusal reordered

`begin` now resolves the token before asking whether another operation is
running. The two refusals send the user somewhere different — "already
exporting" means wait, "no longer loaded" means select it again — and a stale
token answered with the first would send someone to wait for an export whose
finishing cannot help them.

## Dependencies

Three, all permissive, all with an MSRV below this repository's 1.97.1. Versions
are the exact locked ones.

| Crate | Version | Licence | MSRV | Why |
|---|---|---|---|---|
| `resvg` | 0.48.1 | Apache-2.0 OR MIT | 1.85.0 | Rasterizes the SVG this application already writes |
| `png` | 0.18.1 | MIT OR Apache-2.0 | 1.73 | Records physical resolution in `pHYs` |
| `tauri-plugin-clipboard-manager` | 2.3.2 | Apache-2.0 OR MIT | 1.77.2 | Writes an image to the clipboard, from Rust |

`resvg` is taken with `default-features = false` and only `text` and
`system-fonts` enabled. The defaults also carry `raster-images` (which pulls
`gif`, `image-webp` and `zune-jpeg`), `svgz` and `memmap-fonts`. None is
required: the figure this application produces embeds no bitmap, is never
gzipped, and is parsed from a `String` in memory rather than mapped from a file.
`usvg` and `tiny-skia` are used through `resvg`'s own re-exports rather than
added as direct dependencies.

### What they cost

Measured on the same build procedure, `pnpm tauri build --no-bundle`, before and
after:

| | Bytes |
|---|---|
| M4.1 (`3527b77`) | 11,234,816 |
| M4.2 | 15,103,488 |
| Delta | +3,868,672 (+34.4%) |

An observation rather than a budget. Most of it is the raster stack: `resvg`
brings `usvg`, `tiny-skia` and a font pipeline (`fontdb`, `rustybuzz`,
`ttf-parser`), and none of that existed in the graph before. The clipboard plugin
brings `arboard` and `image`.

`png` is a direct dependency for one reason: `tiny_skia::Pixmap::encode_png`
cannot write a `pHYs` chunk, and hand-rolling a chunk and its CRC beside a
reviewed encoder already in this tree would be writing a second PNG
implementation to add four bytes of metadata. It is not additive — `image`, via
`arboard`, via the clipboard plugin, resolves to the same 0.18.1. A second `png`
at 0.17.16 is in the tree and always was: it reaches only `ico` →
`tauri-codegen` → `tauri-macros`, which is a proc-macro and runs at build time.

## PNG is not a second renderer

The scientific figure has exactly one author: `FigureSpec`, drawn by the
deterministic SVG renderer in `mscanvas-plot-spec`. The raster path is:

```
retained SelectedSpectrumResult
  -> FigureSpec(settings.size, settings.theme)
  -> the same deterministic SVG renderer
  -> resvg / usvg parse
  -> RGBA8 at exactly the requested dimensions
  -> png encoder, with pHYs
```

Nothing in that path reads the spectrum, decides a coordinate or writes a label.
Two renderers would be two answers to what the figure says, and a user holding
one file would have no way to know which they had. `Copy plot` is the same path
stopped one step earlier, at the RGBA buffer — the clipboard has no physical
resolution to record, and a test asserts that the copy's pixels and the PNG's
decoded pixels are byte-identical.

Nothing renders the DOM, the screen `StickSpectrum`, a canvas, a screenshot or
the DTO prefix. Every M4.1 full-source guarantee is unchanged: the file is drawn
from the complete spectrum Rust retained, not from the bounded arrays the
interface received.

## Width, height, DPI

Width and height are the **final** dimensions. An SVG is authored at exactly
those figure units; a PNG contains exactly that many pixels; a clipboard image
contains exactly that many pixels. A user who asks for 1200 × 640 receives
1200 × 640.

DPI is physical-resolution **metadata**. It multiplies nothing. It changes no
scientific coordinate, no point count and no pixel count, and it reaches neither
the SVG nor the data documents. What it does is tell whatever opens the PNG how
large the image is meant to be on paper.

That is the only reading under which the two figure formats describe the same
figure, and it is why the control is labelled `PNG DPI` with the words
"PNG metadata only" beside it: a user who expects DPI alone to add pixels, or
expects it to reach every figure, has been misled by the control rather than by
the file.

And because it belongs to one format, it is **read by one format**. `PngDpi` is
its own type, constructed by the PNG export and by nothing else, so a resolution
this boundary cannot record refuses a PNG and leaves `Export SVG…`, `Copy plot`,
CSV and TSV exactly where they were. The alternative — one settings object whose
construction validates every field — was what M4.2 shipped first, and it refused
four working outputs over a number that could not have reached any of them.

The same line is drawn in the interface: the resolution has its own problem
message and its own `aria-describedby`, so a field that is fine is not marked
wrong and a reader is not read a correction belonging to another field.

### What each output consumes

| | Width, height, theme | PNG DPI | Raster budget |
|---|---|---|---|
| `Export SVG…` | yes | — | — |
| `Export PNG…` | yes | yes | yes |
| `Copy plot` | yes | — | yes |
| `Export CSV…` / `Export TSV…` | — | — | — |

A cell that is not `yes` is a question the output is never asked, which is the
same thing as saying it can never be refused over one. A PNG wrong in both of
its own ways is refused over the **resolution first**: it is the smaller
correction, and the size refusal still follows if it is still true. The order is
asserted rather than left to fall out of the code.

### `pHYs`

PNG records physical resolution per metre. One inch is 25.4 mm exactly, so:

```
pixels_per_metre = round(dpi / 0.0254)
```

with `unit = 1` (metres). The conversion is exact up to the rounding a whole
number of pixels per metre forces. Reading it back gives the requested figure
again for **every** accepted resolution — the test walks 72 through 1200 and
asserts the round trip rather than assuming it — and the native suite parses the
`pHYs` chunk out of a file the application actually wrote.

## Bounds

`FigureSize`'s existing validation is unchanged: 200 ≤ width ≤ 20 000, and
180 ≤ height ≤ 20 000 (a one-panel figure's chrome plus its panel).

The raster formats carry an additional budget, because a vector document can
honestly describe a 20 000 × 20 000 figure and a raster one has to hold it. The
pixmap is RGBA8 and therefore exactly four bytes a pixel, so the bound is a
memory bound stated in the unit the user chose:

```
MAX_RASTER_PIXELS = 32_000_000        // 128 MiB of pixmap, plus the encoder's buffer
```

It sits well above real work and well below the pathological case. The default
figure is 0.77 MP. A 7 × 5 inch figure at 600 DPI — about as large as a journal
asks for — is 4200 × 3000, or 12.6 MP. The vector maximum of 20 000 × 20 000 is
400 MP, or 1.6 GiB, and is refused.

It is checked **before anything is allocated**, because a refusal is an answer
and an exhausted machine is not. It is a resource bound, not a service-level
promise about what any particular machine can render: it is what this application
is willing to try to allocate.

And it is a question about the **output**, not about the figure. The settings
constructor does not ask it: a 20,000 x 20,000 figure is a perfectly good vector
document and this application will write one, so refusing those settings outright
would refuse an SVG that renders — while telling the user, in the refusal itself,
that the figure could still be exported as SVG at any size. PNG and `Copy plot`
ask it, immediately before they allocate.

`Copy plot` did not, in the first implementation of this milestone. The two
paths validated independently, nothing said they had to agree, and a
20 000 × 20 000 copy went to the rasterizer. Both now call one check;
`check_repo.py` fails if either entry point stops calling it, and the real-Tauri
suite drives the production copy command at that size and reads the refusal.

DPI is closed at 72 and 1200. A number outside that describes no real output
device and would be recorded in the file as a fact about one. 96, 150, 300 and
600 are all inside it, and each is tested.

Each refusal names which number to change, because "invalid settings" leaves a
reader guessing which of four fields they got wrong.

## Settings freeze at the claim

An export's settings are taken when its reservation is issued and held by the
reservation. The user is about to be in a modal dialog, and a settings change
that lands while they stand in it must not move an export that has already
started onto a different figure. What is written is what was asked for.

They are validated only for the formats that are figures. A data document is the
same measurement whatever the figure is being drawn at, so a width nobody could
draw at must not refuse a CSV -- and the panel, which deliberately leaves the
data actions live in exactly that state, would otherwise be offering a button
that silently did nothing.

## One figure-operation lane

A rasterization is the expensive part of both a PNG save and a copy, and two at
once would be two of them competing for memory with one winning the clipboard for
reasons nobody can see. So `Copy plot` shares the export slot:

- an **unclaimed** reservation is still superseded, which is the M4.1 semantics a
  reload between the two commands depends on;
- anything **claimed** — a dialog, a write, a rasterization, a clipboard call —
  refuses a second operation, and is not disturbed by the refusal.

`Copy plot` needs no reservation because it has no destination to choose and
nothing to come back from; it commits immediately, which is also what makes it
uninterruptible.

## Typography

SVG keeps text as text and needs no typeface. A raster figure needs a real one,
and a rasterizer that cannot find it does not fail — it draws everything except
the words, which is the one outcome a scientific figure must never quietly have.

So fonts come from the platform's own database, through `usvg`'s `system-fonts`
feature, and the question is asked **before** rendering: if nothing resolves the
generic family the figure asks for, PNG and `Copy plot` refuse with a typed
error that points at SVG, which still works. A test proves both halves — the
refusal, and that the same `FigureSpec` still exports as vector on a machine with
no usable font.

No font file is vendored and none is fetched. `check_repo.py` fails on either.

### What determinism is claimed

Within one fixed environment, the same snapshot and settings produce the same
PNG bytes. That is tested.

**No cross-machine byte identity is claimed.** PNG typography depends on the
installed font implementation, and this repository has no evidence about other
machines' fonts. The SVG is a different matter: it is deterministic by semantic
spec, because it carries the text rather than a rendering of it.

## Clipboard

The application is **write-only**.

`Copy plot` builds RGBA in Rust and hands it to `ClipboardExt::write_image`. The
pixels never cross to the webview, which asks for a copy and is told whether one
happened. The plugin is registered so Rust can use it; its own commands are
granted to nobody, because `capabilities/default.json` lists no permission and
Tauri denies every plugin command a capability does not list.

There is no clipboard **read** capability, and there is not going to be one: a
clipboard read would be a window onto whatever the user last copied from
somewhere else, which a scientific tool has no business seeing. The JavaScript
guest plugin is not a dependency either. `check_repo.py` fails if a capability
grants any clipboard permission, or if any clipboard package appears in the
frontend's dependencies.

Because the application cannot read the clipboard, the rendered test cannot
either. The image is read back by the **test process**, which is what any other
program on the machine would see.

A clipboard held open by another program — a clipboard manager, a remote-desktop
session — is a refusal rather than a failure: nothing was copied, the message
says so, and the detail says to try again.

Both halves have now been observed on this machine. During M4.2's implementation
the session's clipboard could not be opened by *any* process, and the readback
test skipped with that condition printed; on the closure-repair run it could,
and the same test asserts an image of exactly the requested size with more than
one colour in it. The skip path stays, because the condition is a property of
the session rather than of the application.

## Production and E2E separation

The `e2e` feature is off by default and never enabled for a release. Under it,
two things are compiled in:

- the rendered-QA IPC boundary from M4.1, one appended initialization script;
- **one synthetic spectrum**, installed into the ordinary export slot at startup.

The synthetic spectrum is what makes the native save path reachable on a machine
with no ProteoWizard installation. It is deliberately **not a command**: there is
nothing for a webview to call, and the registration list is byte-identical in
every build. It takes no arguments, so there is no path to pass it, no command
name to smuggle through it and no size to exhaust a machine with. It is not a
renderer and not a writer — the one thing it produces is a
`SelectedSpectrumResult`, built by the same parser that reads a real backend's
output, from bytes shaped exactly as that backend writes them. Everything after
installation is production code.

`check_repo.py` fails if any of this drifts: the feature becoming default, a
test-only symbol escaping its `cfg`, the seed appearing in the registration list,
a marker reaching the production frontend, a clipboard permission or package
appearing, or a font being vendored or fetched. Each guard was checked by making
the violation and watching it fail.

## The native save residual, closed

M4.1 recorded an explicit residual: the selectors for a save dialog were proved,
but the application's own path — a loaded spectrum, the production export
command, the real dialog, the real writer, a real file — had never been driven.

M4.2 closes it. With the seeded spectrum in place, the rendered suite drives the
real application through the real dialog, chooses a destination with UI
Automation, and parses the file that results: signature, IHDR dimensions, colour
type, bit depth, `pHYs`, and that the image is not empty. Cancel and SVG are
driven the same way.

The dialog is handled from a separate process, because it is modal and holds the
WebView while it is open — the handler is started before the click and races it
to the window. Everything is selected by **automation id** rather than by control
name: `1148` is the file-name edit, `1` is IDOK, `2` is IDCANCEL, and those are
the same on every display language. The names are localised; this machine reports
them in Chinese.

**What this does not prove** is that ProteoWizard can read an mzML file. It was
never meant to. The spectrum is synthetic and reaches the slot through the
production parser.

### What is still open, and which half it belongs to

On the machine this milestone was built on, the rendered suite cannot *complete*
a save: with an export in flight and the application in its dialog phase, no
file-dialog window appears anywhere in the desktop's window list.

That left two candidates, and the rendered evidence could not tell them apart. So
the production function was called directly: `choose_save_destination`, with the
exact facts a PNG export uses, from an ordinary `cargo test` process with no
`tauri-driver`, no WebDriver and no WebView, dismissed from outside by automation
id `2`. It opened, was found by the title the application asked for, and returned
the ordinary cancelled outcome — three consecutive times.

So the production native save dialog is **functional**, and the gap is the
WebDriver-managed session rather than the application. It is recorded as a
bounded environment and automation residual, and it is not claimed as a passing
end-to-end save.

## What M4.2 does not implement

- No chromatogram, TIC, BPC or XIC, and no chromatogram export.
- No zoom, no pan and no current-range export — every figure is the full
  selected-spectrum range.
- No linked figure, no saved `FigureSpec`, no composer, no multi-layer
  comparison.
- No JPEG and no PDF.
- The screen renderer still does not consume `FigureSpec`. Screen and export
  agree by both being right rather than by sharing a type; the screen half of
  M4.1-BLOCKER-A is why that is a live commitment rather than a hope.
- Figure settings are session state. Nothing is persisted across a restart: a
  size silently restored from a previous run would be a property of a file
  nobody chose for it.
- FIG-004 remains partial — selected-spectrum CSV/TSV only.
