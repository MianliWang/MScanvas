<#
.SYNOPSIS
  Shows one Windows save dialog. A probe fixture, not part of any gate.

.DESCRIPTION
  Exists so `dismiss-save-dialog.ps1` can be exercised on a machine where the
  application itself cannot reach its export path -- which is every machine
  without a ProteoWizard installation and an mzML file, because the export
  command refuses a spectrum the backend never loaded long before any dialog
  would be shown.

  What it proves is narrow and worth stating plainly: that the platform's save
  dialog exposes stable, named automation controls, and that the dismisser finds
  and cancels them. It does not prove the application's own export path works.
#>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][string] $Title)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms

$dialog = New-Object System.Windows.Forms.SaveFileDialog
$dialog.Title = $Title
$dialog.Filter = 'SVG figure (*.svg)|*.svg'
$dialog.DefaultExt = 'svg'
[void] $dialog.ShowDialog()
