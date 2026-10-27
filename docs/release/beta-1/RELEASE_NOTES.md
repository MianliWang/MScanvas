# MSCanvas beta 1 — release notes

Status: **DRAFT; NOT RELEASED.** The version, tag, download links, hashes and
signer below are placeholders, filled from the retained candidate manifest at
candidate acceptance. Nothing in this draft says that a candidate has been
built, signed, installed or qualified. The decisions behind it are the
[owner decisions of 2026-10-27](../../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#owner-decisions-2026-10-27).

Installation, first run, uninstall and how to report a problem are in
[Install and support](INSTALL_AND_SUPPORT.md).

## Candidate identity

| Field | Value |
| --- | --- |
| Version | _filled at candidate acceptance_ |
| GitHub prerelease and tag | _filled at candidate acceptance_ |
| Source commit | _filled at candidate acceptance_ |
| Installer file | _filled at candidate acceptance_ |
| Installer SHA-256 | _filled at candidate acceptance_ |
| Signed by | _pending the owner's choice of signing identity_ |
| Qualification record | _filled at candidate acceptance_ |

A rebuilt installer is a new candidate even when its code is unchanged. Check
that the SHA-256 of the file you downloaded matches the table before you run
it; [Install and support](INSTALL_AND_SUPPORT.md#download-and-verify) shows how.

## What beta 1 is

MSCanvas is a local-first desktop workbench for mass-spectrometry data. Beta 1
is a prerelease for early testers of its viewer, converter and figure-export
product. Everything runs on your computer; nothing is uploaded.

- **View mzML.** Add local `.mzML` files by file picker, folder or a drop from
  Explorer, organise them in a session workspace, and inspect one at a time:
  acquisition metadata, the scan table, TIC and BPC traces and the spectrum of
  the selected scan, linked to one another.
- **Convert vendor files to mzML.** Thermo RAW, Shimadzu LabSolutions LCD and
  SCIEX WIFF (with its `.wiff.scan`), through your own ProteoWizard
  installation. Up to 16 acquisitions per queue, converted one at a time, with
  Fail or Skip for names already taken. A result shows what was checked, opens
  its file or folder, and joins the workspace only when you adopt it.
- **Export figures and data.** SVG and PNG figures with a preview of the export,
  a quick PNG, Copy plot to the clipboard, and the underlying data as CSV or TSV.
- **Projects.** Save a local `.mscanvas` document that records the files you
  referenced, each with its length and SHA-256, and a history that is only ever
  added to.
- **Two languages.** The interface reads in English or Simplified Chinese, and
  remembers your language, row spacing and panel choices across restarts.

### Experimental targeted MS1: stored results only

Beta 1 does **not** include the Python/pyOpenMS runtime that the experimental
targeted-MS1 recipe needs, so it cannot start a new targeted run: reviewing a
plan is refused with a message that the runtime is not available in this build.

A project that already holds targeted-MS1 results, saved by a build that could
run the recipe, still opens. Its stored results can be read, drawn and exported
as SVG, PNG and CSV/TSV from the stored result alone. They remain experimental:
not chemical identification, not a validated quantitative assay, and
`NOT_DETECTED` is not proof of absence.

## What beta 1 is not

- Not a vendor-file viewer. Vendor files are converted, not previewed.
- No XIC, peak detection, alignment, statistics or identification.
- A research tool. It makes no clinical or regulatory claim.
- No automatic updates, no telemetry and no cloud service. A new beta is a new
  download.
- ProteoWizard and vendor readers are not bundled. You install and license
  ProteoWizard yourself; MSCanvas never downloads or installs it.
- Not a stable release. Behaviour can change between betas.
- The name *MSCanvas* has not had a formal trademark, package-name or domain
  review. The owner accepted that risk for this prerelease; the name may still
  change before a stable release.

## Supported system

**Windows 11 25H2 x64** is the support target. Other Windows versions and ARM64
are not promised supported. A support target is not a compatibility claim.

Qualification on that target: _recorded at candidate acceptance_. When this
draft was written, no beta-1 candidate had been installed or qualified.

You also need the Microsoft Edge WebView2 Runtime, which most Windows 11
installations already have, and ProteoWizard for previewing mzML and for
conversion. The window needs at least 960 × 640.

## Known limits

### Viewing

- Only `.mzML` files are previewed. Directory-formatted acquisitions, such as a
  `.d` folder, are not recognized.
- TIC and BPC are per-scan values taken from the loaded spectrum table, not a
  chromatogram stored in the file. They are drawn only when the whole table
  loaded. Retention-time and intensity units are shown as *unreported*, because
  the backend output MSCanvas reads does not carry them.
- The scan table transfers at most 100,000 rows; search and filter say when
  they cover only the loaded rows. The on-screen spectrum is a projection of at
  most 1,800 points; figure and data exports read the source, not the screen.
- A session holds up to 1,024 files. The workspace list, its groups, the
  selection and the ranges are not restored after a restart.

### Conversion

- Only the three vendor families above, each on the ProteoWizard build MSCanvas
  has evidence for. On another build, conversion is refused with the reason.
- Output is mzML only. An existing file is never overwritten.
- Conversion settings are limited to the combinations MSCanvas has measured.
  The two centroiding combinations are not offered for vendor files.
- A result is judged on its output alone. MSCanvas cannot read a vendor
  container, so nothing claims fidelity to the source.
- There is no progress percentage or time estimate.
- A ProteoWizard folder you choose by hand lasts for the current session; the
  next start searches automatically again.
- If MSCanvas cannot confirm that a converter process ended, it refuses further
  backend work until you restart it.
- Cleaning up a stranded staging folder works only in the session that created
  it. After a restart, choose a different destination.

### Projects

- A project document is bounded to 4 MiB, and its history cannot be pruned.
- A project records absolute paths of referenced files outside its own folder.
  It is not anonymous; check it before you share it.
- Reopening a project restores no workspace session. Whether its sources are
  still where the project says reads *Not checked* until you run **Check links**.
- Leftovers are not removed for you. A payload store's `.staging/` folder left
  by a crash stays in place. A Save As whose document could not be written
  leaves its result store beside the destination, and a later Save As to that
  name is refused; choose another name or remove that folder yourself.
- Project documents carry schema version 4. A document from another schema
  version is refused, and nothing migrates.

### Stored targeted-MS1 results

- No clipboard copy; export SVG or PNG instead.
- A PNG carries pixels and its DPI only. Provenance travels with the SVG and the
  CSV/TSV.
- The drawn figure's title is the target label and the outcome. The words
  *experimental* and *not proof of absence* are in the SVG description, the
  report and the table help, not drawn in the figure.

### Interface and installation

- A few rare internal errors are shown in the backend's original English,
  labelled as untranslated.
- One light appearance; there is no dark theme.
- A first installation on a machine without WebView2 needs the Internet.
- A signed installer can still trigger a SmartScreen warning.

## CSV and TSV files

MSCanvas writes exported values exactly as they are stored and does not change
them for spreadsheets. Open these files knowingly.

- **Formulas.** A text value that begins with `=`, `+`, `-` or `@` may be
  evaluated as a formula when a spreadsheet opens the file. The text values come
  from stored targeted-MS1 results: target labels and formulas that a person
  typed. Spectrum and chromatogram data files hold only numbers and fixed ASCII
  words. Open a file you did not write yourself through the spreadsheet's text
  import, with its text columns set to *Text*, or in a text editor.
- **Encoding.** Files are UTF-8 **without a byte-order mark**. A spreadsheet
  that assumes the system's legacy code page, as some do when a `.csv` file is
  opened by double-click, can show non-ASCII text such as Chinese labels
  garbled. Import the file as UTF-8 instead.
- **Numbers.** The decimal separator is always `.`, with no thousands separator,
  whatever the interface language. A spreadsheet set to a comma-decimal locale
  can misread them unless the import names `.` as the decimal separator.
- **Layout.** Lines that begin with `#` are a provenance preamble, followed by
  one header row and the records. An absent value is an empty cell, never zero.
  Lines end with a line feed.
- **TSV.** TSV has no quoting. A stored-result table that holds a tab or a line
  break in a value cannot be written as TSV, and the export is refused; use CSV.

## Reporting problems

Use GitHub Issues on this repository, with its bug, feature or UX-research
template. Security problems go through the [security policy](../../../SECURITY.md),
not a public issue. [Install and support](INSTALL_AND_SUPPORT.md#report-a-problem)
explains what to include and how to attach redacted conversion diagnostics.

## Licences

MSCanvas is licensed under Apache-2.0. The installer carries [`LICENSE`](../../../LICENSE)
and [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md), which covers the
packages compiled into the application and its frontend. ProteoWizard is
installed by you and licensed under its own terms.
