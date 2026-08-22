# The native save dialog, and the clipboard

Two things here belong to the operating system rather than to this application:
the save dialog it opens, and the system clipboard it writes to. Neither can be
verified from inside a WebDriver session, so both are driven — or read — from
outside it.

## What is proven

### The dialog can be found and driven

`pnpm e2e:native-dialog` shows a save dialog of the same family the application
shows and drives it with UI Automation. It passes:

```
{"found":true,"cancelled":true,"cancelSelector":"取消","saveSelector":"保存(S)","controlCount":28}
```

The selector question is settled, and the answer is more specific than "yes". The
button *names* are localised — this machine reports Cancel as 取消 — so a
name-based selector would work in one display language only. The automation ids
are not: `1` is IDOK, `2` is IDCANCEL, `1148` is the file-name edit, on every
display language, and those are what `save-dialog.ps1` asks for.

### The export path reaches the dialog

This is what M4.1 could not do at all. Under the `e2e` feature Rust installs one
synthetic spectrum into the ordinary export slot at startup, so the production
commands have something real to name. `pnpm e2e:tauri` now drives the real
application through:

- the real `begin_selected_spectrum_export`, which validates the figure settings
  and matches the token against the retained snapshot;
- the real `copy_selected_spectrum_plot`, which builds the real `FigureSpec`,
  renders the real SVG, rasterizes it with `resvg` and calls the platform
  clipboard.

Pressing `Export PNG…` puts the application into its dialog phase — the panel
says "Choose where to save the PNG file." — so the command runs, claims its
reservation and dispatches the picker.

## Which half is broken: the discriminator

The rendered evidence alone could not say whether the missing dialog was the
WebDriver-managed session or `choose_save_destination` itself, and calling one of
them environmental without testing the other would have been a guess. So the
production function was called directly.

A temporary in-crate test invoked the exact production
`preview::dialog::choose_save_destination`, with the exact `SaveDialogFacts` a
PNG export uses (`SpectrumExportFormat::Png.dialog()`) and the ordinary proposed
name `mscanvas-spectrum-0.png`, from an ordinary `cargo test` process — no
`tauri-driver`, no WebDriver, no WebView. Nothing was reimplemented: if a dialog
appeared, the production boundary opened it. `save-dialog.ps1` dismissed it from
outside, selecting Cancel by automation id `2`.

It passed, three consecutive times, in about six seconds each:

```
PROBE driver:  {"title":"Export spectrum figure","found":true,"invoked":true}
PROBE outcome: Ok(None)
```

The dialog opened, UI Automation found it **by the title the application asked
for**, Cancel was invoked by its stable id, and the production function returned
the ordinary cancelled outcome — no path, and not an error.

So the production native save dialog is functional. What does not work is the
WebDriver-managed session, and that is where the residual lies.

The owner-bound form was deliberately not exercised: a probe process has no
application window, and a synthesised or borrowed HWND would be testing
something the product never does.

The probe itself was removed after it answered the question. Re-creating it is a
short test that calls the function above and spawns `save-dialog.ps1`; it was not
kept because it opens a real window and would hang a run whose dismissal failed.

## What is not proven, and why

**The save is not completed by automation, and no file is written by a test.**

With the export in flight and the application in its dialog phase, no file-dialog
window appears in the desktop's window list for ninety seconds — not by title,
not by class, and not by searching every top-level window for the file-name edit
that identifies one. Meanwhile the same probe that drives a shell-created dialog
still passes on the same machine, minutes apart. So the shell can show and be
driven for a file dialog; the application's, when the application is being driven
by WebDriver, does not become visible to it.

`m4.2-native-save.native.e2e.ts` is written and complete — it chooses a
destination, saves, and parses the resulting file's signature, IHDR dimensions,
colour type, bit depth and `pHYs` chunk. It is **deliberately not part of
`pnpm e2e:tauri`**, because a gate that cannot pass is not a gate. Run it with:

```
pnpm e2e:native-save
```

on a session where the application's dialog is drivable.

**The clipboard image is not read back.** This Windows session cannot open the
clipboard from *any* process: `System.Windows.Forms.Clipboard.SetImage` fails
from PowerShell with "the requested clipboard operation failed", repeatedly, with
no window holding it. That is a machine condition rather than anything about
MSCanvas — and MSCanvas behaves correctly under it, refusing with a typed,
retryable message that says nothing was copied and why.

`m4.2-clipboard.tauri.e2e.ts` detects that condition before blaming the
application and skips with the reason printed. It is a skip, not a pass: where
the clipboard works it asserts an image is present, of exactly the requested
size, with more than one colour in it.

## What would close these

For the save: a Windows session where the application's own dialog is visible to
UI Automation *while WebDriver drives the application*. Everything else — the
seed, the production path, the dialog function, the dialog driver, the PNG
parser — already exists and is exercised, and the dialog function is now known to
work when nothing is driving the application.

For the clipboard: a session whose clipboard can be opened. The application is
write-only and will stay that way, so the reading will always happen from a test
process rather than from inside.

## Scripts

| File | What it does |
|---|---|
| `probe-save-dialog.ps1` | Shows a shell save dialog and drives the dismisser against it. Feasibility only. |
| `show-save-dialog.ps1` | The fixture that probe shows. Not part of any gate. |
| `dismiss-save-dialog.ps1` | Finds a dialog by title and cancels it through IDCANCEL. |
| `save-dialog.ps1` | Finds the application's dialog, types a destination and saves, or cancels. Reports what it saw when it finds nothing. |
| `read-clipboard-image.ps1` | Reads the clipboard image from the test process, or clears it. |
| `focus-window.ps1` | Brings the application's window to the foreground, which a real user's window always is. |
