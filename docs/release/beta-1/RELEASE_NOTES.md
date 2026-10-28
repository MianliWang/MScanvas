# MSCanvas beta 1 — release notes

Status: **DRAFT; NOT RELEASED.** The candidate identity below is the first
beta-1 candidate, built by the `Release candidate` workflow; a rebuild is a new
candidate and replaces every value in the table. The download link is filled
when the prerelease is published. The decisions behind it are the
[owner decisions of 2026-10-27](../../architecture/adr/0047-first-windows-beta-scope-and-implementation-route.md#owner-decisions-2026-10-27).

Installation, first run, uninstall and how to report a problem are in
[Install and support](INSTALL_AND_SUPPORT.md).

## Candidate identity

| Field | Value |
| --- | --- |
| Version | 0.1.0 (beta 1) |
| GitHub prerelease and tag | `v0.1.0-beta.1`, created when the prerelease is published |
| Source commit | `e6d2a49e5061398c0ed2a374b2efa90d3d1c4c0e` on `main` |
| Installer file | `MSCanvas_0.1.0_x64-setup.exe`, 6,469,906 bytes |
| Installer SHA-256 | `4bf752addff63c489df440814efbd2adb9f445cb41ce406bdf6d9a035c657ee8` |
| Code signature | **None.** Beta 1 is not code-signed |
| Build provenance | GitHub build-provenance attestation of the installer, from [workflow run 40618719468](https://github.com/MianliWang/MScanvas/actions/runs/40618719468) of `release-candidate.yml` on `main` |
| Qualification record | [How beta 1 was checked](#how-beta-1-was-checked) |

A rebuilt installer is a new candidate even when its code is unchanged. Check
that the SHA-256 of the file you downloaded matches the table before you run
it; [Install and support](INSTALL_AND_SUPPORT.md#download-and-verify) shows how.

## How beta 1 was checked

_Results are filled from the qualification records before publication._

- Automated: the whole frontend unit suite, the whole browser suite and a
  rendered check of every presentation change in beta 1, in English and
  Simplified Chinese, on the source above.
- Native: the Tauri and native suites against a QA build of the same source
  at real 150% Windows scaling, including real ProteoWizard conversions of a
  Thermo RAW test acquisition.
- Installed: this installer, installed, used and uninstalled on a
  maintainer's machine.

What was **not** done for beta 1, accepted by the owner on 2026-10-28 and
stated here rather than hidden:

- No installation on a clean machine or a fresh standard-user account. The
  installed check ran in a maintainer's own account, on a machine that already
  had ProteoWizard and earlier MSCanvas development builds.
- Some states have no native check: loading and error states held open,
  running conversions and targeted runs, damaged or missing stored results,
  and expanded figure controls. They are covered by the browser and unit
  suites only.
- No formal trademark, package-name or domain review of the name MSCanvas.
- The installer is not code-signed; see
  [Install and support](INSTALL_AND_SUPPORT.md#download-and-verify).

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
  Fail or Skip for names already taken. A result reports what was measured of
  its output, opens its file or folder, and joins the workspace only when you
  adopt it.
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
- Not a clinical or regulatory tool. It is for research use and makes no
  clinical or regulatory claim.
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
installations already have, and ProteoWizard for reading mzML runs, conversion
and figure export. The window needs at least 960 × 640.

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
  still where the project says reads *Not checked* until you run **Check linked
  files** (Chinese interface: **检查已链接的文件**).
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
- The installer is not code-signed: Windows names an unknown publisher,
  SmartScreen is expected to warn, and an organisation that blocks unsigned
  software will block it.

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
template. Security problems are reported privately, not in a public issue,
through GitHub's private vulnerability reporting, as the
[security policy](../../../SECURITY.md) describes. [Install and support](INSTALL_AND_SUPPORT.md#report-a-problem)
explains what to include and how to attach redacted conversion diagnostics.

## Licences

MSCanvas is licensed under Apache-2.0. The installer carries [`LICENSE`](../../../LICENSE)
and [`THIRD_PARTY_NOTICES.md`](../../../THIRD_PARTY_NOTICES.md), which covers the
packages compiled into the application and its frontend. ProteoWizard is
installed by you and licensed under its own terms.
