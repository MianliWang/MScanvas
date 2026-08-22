<#
.SYNOPSIS
  Brings the application's own window to the foreground.

.DESCRIPTION
  A person pressing `Copy plot` is looking at the window they pressed it in. A
  WebDriver session is not: it drives the application without ever activating
  it, and on Windows a process whose window has never been foreground can be
  refused the clipboard outright.

  So this restores the condition a real use has rather than working around one
  the application creates. It is a property of how the suite drives the
  application, not of what the application does -- which is why it lives here and
  not in the product.

  Reports which window it activated, so a test can tell "the window was not
  found" from "the clipboard refused us anyway".
#>
[CmdletBinding()]
param([string] $TitleContains = 'MSCanvas')

$ErrorActionPreference = 'Stop'

Add-Type -Namespace MSCanvas -Name Windows -MemberDefinition @'
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr hWnd);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr hWnd, int nCmdShow);
'@

$window = Get-Process |
  Where-Object { $_.MainWindowHandle -ne 0 -and $_.MainWindowTitle -like "*$TitleContains*" } |
  Select-Object -First 1

if ($null -eq $window) {
  [ordered]@{ focused = $false; detail = "no window whose title contains '$TitleContains'" } |
    ConvertTo-Json -Compress
  exit 2
}

# 9 is SW_RESTORE: a minimised window cannot be brought forward without it.
[void] [MSCanvas.Windows]::ShowWindow($window.MainWindowHandle, 9)
$ok = [MSCanvas.Windows]::SetForegroundWindow($window.MainWindowHandle)
Start-Sleep -Milliseconds 200

[ordered]@{
  focused = [bool] $ok
  process = $window.ProcessName
  title   = $window.MainWindowTitle
} | ConvertTo-Json -Compress
exit 0
