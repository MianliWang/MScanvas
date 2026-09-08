<#
.SYNOPSIS
  Chooses or cancels the current test application's conversion destination.
.DESCRIPTION
  Shares the process, title, native-class and HWND checks with the acquisition
  picker, selecting the folder dialog's own edit resource ID (1152).
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int] $ApplicationProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('choose', 'cancel', 'escape')][string] $Action,
  [string] $Path = '',
  [ValidateRange(1, 120)][int] $TimeoutSeconds = 60
)

& (Join-Path $PSScriptRoot 'choose-workspace-files.ps1') -ApplicationProcessId $ApplicationProcessId -Action $Action -Path $Path -TimeoutSeconds $TimeoutSeconds -DialogKind conversionFolder
exit $LASTEXITCODE
