<#
.SYNOPSIS
  Drives the current test application's native acquisition picker.
.DESCRIPTION
  Start before the WebDriver click: the OS modal holds that click open. Match
  only this application's process and exact dialog title, then native control
  class and resource ID. No other application or unnamed dialog is a fallback.
  The folder wrapper reuses this bounded mechanism with its different edit ID.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int] $ApplicationProcessId,
  [Parameter(Mandatory = $true)][ValidateSet('choose', 'cancel', 'escape')][string] $Action,
  [string] $Path = '',
  [ValidateRange(1, 120)][int] $TimeoutSeconds = 60,
  [ValidateSet('workspaceFiles', 'conversionFolder')][string] $DialogKind = 'workspaceFiles'
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace MSCanvasPicker -Name Native -MemberDefinition @'
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(System.IntPtr hWnd);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr hWnd, out int processId);
  [DllImport("user32.dll")] public static extern bool IsChild(System.IntPtr parent, System.IntPtr child);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(System.IntPtr hWnd);
  [DllImport("user32.dll")] public static extern System.IntPtr GetForegroundWindow();
  [DllImport("user32.dll", SetLastError=true)] public static extern System.IntPtr SendMessageTimeout(System.IntPtr hWnd, uint message, System.UIntPtr wParam, System.IntPtr lParam, uint flags, uint timeout, out System.UIntPtr result);
'@

$title = if ($DialogKind -eq 'workspaceFiles') { 'Open acquisitions' } else { 'Choose where to save the converted mzML' }
$editId = if ($DialogKind -eq 'workspaceFiles') { '1148' } else { '1152' }
$result = [ordered]@{ kind = $DialogKind; action = $Action; processId = $ApplicationProcessId; found = $false; entered = $false; invoked = $false; closed = $false; method = ''; detail = '' }

function Find-OwnedDialog {
  $byProcess = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ProcessIdProperty, $ApplicationProcessId)
  $byTitle = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, $title)
  $windows = [System.Windows.Automation.AutomationElement]::RootElement.FindAll(
    [System.Windows.Automation.TreeScope]::Children, $byProcess)
  foreach ($window in $windows) {
    if ($window.Current.Name -eq $title -and $window.Current.ClassName -eq '#32770') { return $window }
    $candidate = $window.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $byTitle)
    if ($null -ne $candidate -and $candidate.Current.ProcessId -eq $ApplicationProcessId -and $candidate.Current.ClassName -eq '#32770') { return $candidate }
  }
  return $null
}

function Find-Control {
  param($Dialog, [string] $Id, [string] $Class)
  $byId = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $Id)
  $byClass = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ClassNameProperty, $Class)
  $condition = New-Object System.Windows.Automation.AndCondition($byId, $byClass)
  return $Dialog.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
}

function Invoke-OwnedButton {
  param($Dialog, $Button, [int] $Id)
  $dialogHandle = [IntPtr] $Dialog.Current.NativeWindowHandle
  $buttonHandle = [IntPtr] $Button.Current.NativeWindowHandle
  $ownerId = 0
  [void] [MSCanvasPicker.Native]::GetWindowThreadProcessId($buttonHandle, [ref] $ownerId)
  if ($buttonHandle -eq [IntPtr]::Zero -or $ownerId -ne $ApplicationProcessId -or
      [MSCanvasPicker.Native]::GetDlgCtrlID($buttonHandle) -ne $Id -or
      -not [MSCanvasPicker.Native]::IsChild($dialogHandle, $buttonHandle)) {
    throw 'The native button ownership check failed.'
  }
  $pattern = $null
  if ($Button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref] $pattern)) {
    $pattern.Invoke()
    return 'UIAutomation.Invoke'
  }
  # Some Windows common-dialog buttons expose a native Button HWND but no
  # InvokePattern. BM_CLICK activates that verified button, with a bounded wait.
  $messageResult = [UIntPtr]::Zero
  $sent = [MSCanvasPicker.Native]::SendMessageTimeout($buttonHandle, 0xF5, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 5000, [ref] $messageResult)
  if ($sent -eq [IntPtr]::Zero) { throw 'The native button click timed out or failed.' }
  return 'Win32.BM_CLICK'
}

try {
  $application = Get-Process -Id $ApplicationProcessId
  if ($application.ProcessName -ne 'mscanvas-desktop') { throw 'The supplied process is not MSCanvas.' }
  if ($Action -eq 'choose') {
    if (-not [IO.Path]::IsPathRooted($Path)) { throw 'Choosing requires an absolute path.' }
    $pathType = if ($DialogKind -eq 'workspaceFiles') { 'Leaf' } else { 'Container' }
    if (-not (Test-Path -LiteralPath $Path -PathType $pathType)) { throw 'The supplied picker path does not exist with the expected kind.' }
    $Path = (Resolve-Path -LiteralPath $Path).Path
  }
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  $dialog = $null
  $button = $null
  $valuePattern = $null
  $buttonId = if ($Action -eq 'choose') { '1' } else { '2' }
  while ((Get-Date) -lt $deadline) {
    $dialog = Find-OwnedDialog
    if ($null -ne $dialog) {
      $button = Find-Control -Dialog $dialog -Id $buttonId -Class 'Button'
      if ($Action -ne 'choose' -and $null -ne $button -and $button.Current.IsEnabled) { break }
      $edit = Find-Control -Dialog $dialog -Id $editId -Class 'Edit'
      if ($null -ne $button -and $button.Current.IsEnabled -and $null -ne $edit -and
          $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref] $valuePattern)) { break }
    }
    Start-Sleep -Milliseconds 100
  }
  if ($null -eq $dialog -or $null -eq $button -or ($Action -eq 'choose' -and $null -eq $valuePattern)) {
    throw 'The exact owned picker controls did not become ready before the timeout.'
  }
  $result.found = $true
  if ($Action -eq 'choose') {
    $valuePattern.SetValue($Path)
    $result.entered = $true
  }
  if ($Action -eq 'escape') {
    # Send a real Escape only while this exact owned dialog has foreground.
    # A refused activation fails rather than typing into whichever app is active.
    Add-Type -AssemblyName System.Windows.Forms
    [void] [MSCanvasPicker.Native]::SetForegroundWindow([IntPtr] $dialog.Current.NativeWindowHandle)
    $button.SetFocus()
    $foreground = [MSCanvasPicker.Native]::GetForegroundWindow()
    $foregroundOwner = 0
    [void] [MSCanvasPicker.Native]::GetWindowThreadProcessId($foreground, [ref] $foregroundOwner)
    if ($foregroundOwner -ne $ApplicationProcessId -or $foreground -ne [IntPtr] $dialog.Current.NativeWindowHandle) {
      throw 'Escape refused because the exact owned dialog is not foreground.'
    }
    [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
    $result.method = 'WindowsForms.SendKeys.Escape'
  } else {
    $result.method = Invoke-OwnedButton -Dialog $dialog -Button $button -Id ([int] $buttonId)
  }
  $result.invoked = $true
  $closeDeadline = (Get-Date).AddSeconds(10)
  while ((Get-Date) -lt $closeDeadline) {
    if ($null -eq (Find-OwnedDialog)) { $result.closed = $true; break }
    Start-Sleep -Milliseconds 100
  }
  if (-not $result.closed) { throw 'The owned picker remained open after activation.' }
  $result | ConvertTo-Json -Compress
  exit 0
} catch {
  $result.detail = $_.Exception.Message
  # Never leave an identified test-owned modal holding subsequent WebDriver
  # commands. This recovery still cannot address a different app or dialog.
  try {
    $remaining = Find-OwnedDialog
    if ($null -ne $remaining) {
      $cancel = Find-Control -Dialog $remaining -Id '2' -Class 'Button'
      if ($null -ne $cancel) { [void] (Invoke-OwnedButton -Dialog $remaining -Button $cancel -Id 2) }
    }
  } catch { $result.detail += ' The owned picker could not be dismissed.' }
  $result | ConvertTo-Json -Compress
  exit 1
}
