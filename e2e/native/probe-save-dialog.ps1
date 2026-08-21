<#
.SYNOPSIS
  Establishes whether the platform's save dialog can be driven by stable
  selectors, and whether the dismisser finds and cancels it.

.DESCRIPTION
  This is a feasibility probe, and its scope is worth stating before its result
  is read. It shows a Windows save dialog of the same family the application
  shows -- the shell's `IFileSaveDialog` -- and then runs the real dismisser
  against it. What it can establish is that the dialog exposes stable automation
  ids, that they are the same ids the dismisser asks for, and that invoking
  Cancel closes the window.

  What it cannot establish is that the application's own export path reaches a
  dialog at all. On a machine without a ProteoWizard installation and an mzML
  file, it does not: the backend never loads a spectrum, Rust therefore holds no
  snapshot, and `begin_selected_spectrum_export` refuses the stale token long
  before any dialog would be shown. That end of the path is an explicit
  residual, recorded in `e2e/native/README.md`, and this probe does not stand in
  for it.

  Exits 0 when the dialog was found and cancelled, non-zero otherwise.
#>
[CmdletBinding()]
param([string] $Title = 'Export spectrum figure')

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path

$fixture = Start-Process -FilePath 'powershell.exe' -PassThru -ArgumentList @(
  '-NoProfile', '-STA', '-ExecutionPolicy', 'Bypass',
  '-File', ('"' + (Join-Path $here 'show-save-dialog.ps1') + '"'),
  '-Title', ('"' + $Title + '"'))

try {
  $json = & powershell.exe -NoProfile -ExecutionPolicy Bypass `
    -File (Join-Path $here 'dismiss-save-dialog.ps1') -Title $Title -TimeoutSeconds 30
  $code = $LASTEXITCODE
  $report = $json | ConvertFrom-Json

  # The dialog's button *names* are localised -- this machine reports the Cancel
  # button as 取消 -- which is exactly why the dismisser selects on the
  # automation id instead. `1` and `2` are IDOK and IDCANCEL, and they are the
  # same on every display language.
  $cancel = $report.controls | Where-Object { $_.automationId -eq '2' }
  $save = $report.controls | Where-Object { $_.automationId -eq '1' }

  [ordered]@{
    found            = $report.found
    cancelled        = $report.cancelled
    cancelSelector   = if ($null -eq $cancel) { $null } else { $cancel.name }
    saveSelector     = if ($null -eq $save) { $null } else { $save.name }
    controlCount     = $report.controls.Count
    detail           = $report.detail
  } | ConvertTo-Json -Compress

  if ($code -ne 0 -or -not $report.cancelled -or $null -eq $cancel) {
    exit 1
  }
  exit 0
}
finally {
  if (-not $fixture.HasExited) { $fixture | Stop-Process -Force }
}
