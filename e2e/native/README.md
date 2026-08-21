# The native save dialog

The save dialog is not this application's window. It belongs to the operating
system, it is modal, and no WebDriver session has authority over it — a fact the
suite learned the expensive way, when one unmocked click on `Export SVG…` held
the WebView until the run's own timeout expired.

## What was established

UI Automation does have that authority, and it is present on every supported
Windows installation, so using it adds no dependency to this repository.
`dismiss-save-dialog.ps1` finds a dialog by the title the application itself
chooses (`SaveDialogFacts::title`) and cancels it through the Cancel button's
invoke pattern.

`probe-save-dialog.ps1` runs that dismisser against a real shell save dialog of
the same family the application shows, and it passes:

```
{"found":true,"cancelled":true,"cancelSelector":"取消","saveSelector":"保存(S)","controlCount":28}
```

The selector question is settled, and the answer is more specific than "yes".
The button *names* are localised — this machine reports Cancel as 取消 — so a
name-based selector would be a selector that works on one machine's language.
The automation ids are not: `1` is IDOK and `2` is IDCANCEL, on every display
language, and those are what the dismisser asks for.

Run it with `pnpm e2e:native-dialog`.

## What remains a residual

**The application's own export path has not been driven to a real save dialog on
this machine, and the probe above does not stand in for that.**

The reason is not the dialog and not the selectors. It is that the path cannot
be reached here at all:

- Reaching the export action requires a loaded spectrum.
- Loading a spectrum requires a ProteoWizard installation and an mzML file,
  neither of which this machine has, so `open_mzml_preview` and
  `load_selected_spectrum` are answered from the test table rather than by the
  backend.
- Rust therefore never installs a spectrum snapshot. `begin_selected_spectrum_export`
  matches the frontend's token against that absent snapshot, finds it stale, and
  returns a typed refusal — long before any dialog would be shown.

So on this machine the dialog is unreachable by construction, and a test that
claimed otherwise would be claiming something it did not do. No mandatory gate
was created for it.

## What would close it

A machine with a working ProteoWizard backend and a real mzML fixture. There the
existing Tauri suite could seed nothing, drive the real path, spawn
`dismiss-save-dialog.ps1` before the click, and assert that the application
reports a cancelled export. Every piece of that except the backend already
exists and is exercised.
