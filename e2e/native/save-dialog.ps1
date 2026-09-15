<#
.SYNOPSIS
  Drives one of this application's save dialogs: types a destination and saves,
  or cancels.

.DESCRIPTION
  The save dialog is modal and belongs to the operating system. While it stands
  open the WebView is held, so every WebDriver command the rendered suite would
  issue blocks -- which is why this runs as a separate process, started before
  the click that opens the dialog and racing it to the window.

  Everything is selected by automation id rather than by control name. The ids
  are the dialog resource's own and are the same on every display language; the
  names are localised, and this machine reports them in Chinese. A suite keyed
  on names would be a suite that passes in one locale.

    FileNameControlHost / Edit 1001  the attributed modern save dialog
    1148  the legacy caller's file-name edit
    1     IDOK, the Save button
    2     IDCANCEL

  Writes one JSON object to standard output saying what it found and what it
  did, so a caller can assert on it rather than infer from an exit code alone.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $Title,
  [Parameter(Mandatory = $true)][ValidateSet('save', 'cancel')][string] $Action,
  [string] $Path = '',
  [ValidateRange(0, 2147483647)][int] $ApplicationProcessId = 0,
  [int] $TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes
Add-Type -Namespace MSCanvasSaveDialog -Name Native -MemberDefinition @'
  public delegate bool Enumerator(IntPtr window, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumWindows(Enumerator callback, IntPtr parameter);
  [DllImport("user32.dll")] static extern bool EnumChildWindows(IntPtr parent, Enumerator callback, IntPtr parameter);
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr window, out int processId);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetClassName(IntPtr window, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern int GetWindowText(IntPtr window, System.Text.StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] static extern bool IsWindowEnabled(IntPtr window);
  [DllImport("user32.dll", EntryPoint = "GetWindowLongW", ExactSpelling = true)] static extern int GetWindowStyle(IntPtr window, int index);
  [DllImport("user32.dll")] public static extern bool IsChild(IntPtr parent, IntPtr child);
  [DllImport("user32.dll")] public static extern int GetDlgCtrlID(IntPtr window);
  [DllImport("user32.dll", SetLastError = true)] public static extern IntPtr SendMessageTimeout(IntPtr window, uint message, UIntPtr wParam, IntPtr lParam, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr SendText(IntPtr window, uint message, UIntPtr wParam, string text, uint flags, uint timeout, out UIntPtr result);
  [DllImport("user32.dll", EntryPoint = "SendMessageTimeoutW", ExactSpelling = true, CharSet = CharSet.Unicode, SetLastError = true)] static extern IntPtr ReadText(IntPtr window, uint message, UIntPtr wParam, System.Text.StringBuilder text, uint flags, uint timeout, out UIntPtr result);
  public sealed class WindowInfo { public long handle; public string title, className; public bool visible; }
  public sealed class ControlInfo { public long handle; public int id; public string className; public bool visible; }
  static void AssertFilename(IntPtr dialog, IntPtr host, IntPtr edit, int processId) {
    int dialogOwner, hostOwner, editOwner;
    GetWindowThreadProcessId(dialog, out dialogOwner);
    GetWindowThreadProcessId(host, out hostOwner);
    GetWindowThreadProcessId(edit, out editOwner);
    var className = new System.Text.StringBuilder(256);
    GetClassName(edit, className, className.Capacity);
    if (dialog == IntPtr.Zero || host == IntPtr.Zero || edit == IntPtr.Zero ||
        dialogOwner != processId || hostOwner != processId || editOwner != processId ||
        !IsChild(dialog, host) || !IsChild(host, edit) || GetDlgCtrlID(edit) != 1001 ||
        className.ToString() != "Edit" || !IsWindowVisible(edit) || !IsWindowEnabled(edit) ||
        (GetWindowStyle(edit, -16) & 0x0800) != 0) // GWL_STYLE / ES_READONLY
      throw new InvalidOperationException("Native filename ownership changed before text access.");
  }
  public static void EnterFilename(IntPtr dialog, IntPtr host, IntPtr edit, int processId, string value) {
    AssertFilename(dialog, host, edit, processId);
    UIntPtr result;
    // WM_SETTEXT targets this exact owned Edit; no keyboard or activation.
    if (SendText(edit, 0x000C, UIntPtr.Zero, value, 0x0022, 5000, out result) == IntPtr.Zero || result == UIntPtr.Zero)
      throw new InvalidOperationException("The owned filename text write failed or timed out.");
    AssertFilename(dialog, host, edit, processId);
    // One extra character beyond the expected text detects a truncated prefix.
    var readback = new System.Text.StringBuilder(value.Length + 2);
    if (ReadText(edit, 0x000D, new UIntPtr((uint)readback.Capacity), readback, 0x0022, 5000, out result) == IntPtr.Zero ||
        result.ToUInt64() != (ulong)value.Length || !String.Equals(readback.ToString(), value, StringComparison.Ordinal))
      throw new InvalidOperationException("The owned filename text did not read back exactly.");
  }
  public static ControlInfo[] OwnedControls(IntPtr dialog, int processId) {
    int owner;
    GetWindowThreadProcessId(dialog, out owner);
    if (dialog == IntPtr.Zero || owner != processId) throw new InvalidOperationException("Control observation requires the owned dialog.");
    var controls = new System.Collections.Generic.List<ControlInfo>();
    EnumChildWindows(dialog, delegate(IntPtr control, IntPtr parameter) {
      int controlOwner;
      GetWindowThreadProcessId(control, out controlOwner);
      if (controlOwner != processId) return true;
      var className = new System.Text.StringBuilder(256);
      GetClassName(control, className, className.Capacity);
      controls.Add(new ControlInfo { handle = control.ToInt64(), id = GetDlgCtrlID(control), className = className.ToString(), visible = IsWindowVisible(control) });
      return true;
    }, IntPtr.Zero);
    return controls.ToArray();
  }
  public static WindowInfo[] OwnedWindows(int processId) {
    var windows = new System.Collections.Generic.List<WindowInfo>();
    EnumWindows(delegate(IntPtr window, IntPtr parameter) {
      int owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner != processId) return true;
      var title = new System.Text.StringBuilder(1024);
      var className = new System.Text.StringBuilder(256);
      GetWindowText(window, title, title.Capacity);
      GetClassName(window, className, className.Capacity);
      windows.Add(new WindowInfo { handle = window.ToInt64(), title = title.ToString(), className = className.ToString(), visible = IsWindowVisible(window) });
      return true;
    }, IntPtr.Zero);
    return windows.ToArray();
  }
'@

if ($ApplicationProcessId -ne 0 -and (Get-Process -Id $ApplicationProcessId).ProcessName -ne 'mscanvas-desktop') {
  throw 'The supplied process is not MSCanvas.'
}

function Find-Dialog {
  param([string] $Name, [int] $Seconds)

  if ($ApplicationProcessId -ne 0) {
    # A native common dialog can exist without being a UIA root child. Bridge
    # only its exact PID, title and class HWND into UIA; never use another app
    # or a filename-field match as an attributed-dialog fallback.
    $deadline = (Get-Date).AddSeconds($Seconds)
    while ((Get-Date) -lt $deadline) {
      $matches = @([MSCanvasSaveDialog.Native]::OwnedWindows($ApplicationProcessId) | Where-Object {
        $_.visible -and $_.className -ceq '#32770' -and [String]::Equals($_.title, $Name, [StringComparison]::Ordinal)
      })
      if ($matches.Count -gt 1) { throw 'More than one exact owned save dialog was found.' }
      if ($matches.Count -eq 1) {
        $handle = [IntPtr] $matches[0].handle
        $found = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
        if ($null -ne $found -and $found.Current.ProcessId -eq $ApplicationProcessId -and
            [IntPtr] $found.Current.NativeWindowHandle -eq $handle) { return $found }
      }
      Start-Sleep -Milliseconds 200
    }
    return $null
  }

  # Preserve the legacy, unattributed caller's UIA lookup.
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $byName = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, $Name)
  # The file-name edit. Its id is the dialog resource's own, so a window that
  # has one *is* a file dialog whatever it is called -- which matters, because
  # the title an application asks for is not always the name the shell gives the
  # window, and a window with no name at all is still the dialog the user is
  # standing in front of.
  $byFileNameField = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '1148')

  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $found = $root.FindFirst([System.Windows.Automation.TreeScope]::Children, $byName)
    if ($null -ne $found -and ($ApplicationProcessId -eq 0 -or $found.Current.ProcessId -eq $ApplicationProcessId)) { return $found }

    $windows = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($window in $windows) {
      if ($ApplicationProcessId -ne 0 -and $window.Current.ProcessId -ne $ApplicationProcessId) { continue }
      if ($null -ne $window.FindFirst(
            [System.Windows.Automation.TreeScope]::Descendants, $byFileNameField)) {
        return $window
      }
    }
    Start-Sleep -Milliseconds 200
  }
  return $null
}

function Find-ById {
  param($Dialog, [string] $AutomationId)

  return $Dialog.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::AutomationIdProperty, $AutomationId)))
}

function Assert-OwnedControl {
  param($Dialog, $Control, [int] $Id)
  if ($ApplicationProcessId -eq 0) { return }
  $dialogHandle = [IntPtr] $Dialog.Current.NativeWindowHandle
  $controlHandle = [IntPtr] $Control.Current.NativeWindowHandle
  $dialogOwner = 0
  $controlOwner = 0
  [void] [MSCanvasSaveDialog.Native]::GetWindowThreadProcessId($dialogHandle, [ref] $dialogOwner)
  [void] [MSCanvasSaveDialog.Native]::GetWindowThreadProcessId($controlHandle, [ref] $controlOwner)
  $isChild = [MSCanvasSaveDialog.Native]::IsChild($dialogHandle, $controlHandle)
  $observedId = [MSCanvasSaveDialog.Native]::GetDlgCtrlID($controlHandle)
  $result.controlChecks += [ordered]@{
    expectedId = $Id; observedId = $observedId; dialogHandle = $dialogHandle.ToInt64()
    controlHandle = $controlHandle.ToInt64(); dialogOwner = $dialogOwner; controlOwner = $controlOwner
    isChild = $isChild; automationId = $Control.Current.AutomationId; className = $Control.Current.ClassName
  }
  if ($controlHandle -eq [IntPtr]::Zero -or $dialogOwner -ne $ApplicationProcessId -or
      $controlOwner -ne $ApplicationProcessId -or
      -not $isChild -or $observedId -ne $Id) {
    $result.detail = 'The native save control ownership or resource ID check failed.'
    $result.controls = Get-OwnedControlEvidence -Dialog $Dialog
    $result | ConvertTo-Json -Depth 5 -Compress
    throw 'The native save control ownership or resource ID check failed.'
  }
}

function Find-FileName {
  param($Dialog)
  if ($ApplicationProcessId -eq 0) { return Find-ById -Dialog $Dialog -AutomationId '1148' }

  # The UIA provider and native HWND tree need not expose identical parentage.
  # Bind the observed filename host to its exact native Edit1001 child, then
  # bridge that HWND into UIA. A toolbar elsewhere also has ID1001.
  $script:filenameLookup = 'filename host not found'
  $hostControl = Find-ById -Dialog $Dialog -AutomationId 'FileNameControlHost'
  if ($null -eq $hostControl -or $hostControl.Current.ProcessId -ne $ApplicationProcessId) { return $null }
  $hostHandle = [IntPtr] $hostControl.Current.NativeWindowHandle
  $hostOwner = 0
  [void] [MSCanvasSaveDialog.Native]::GetWindowThreadProcessId($hostHandle, [ref] $hostOwner)
  if ($hostHandle -eq [IntPtr]::Zero -or $hostOwner -ne $ApplicationProcessId -or
      -not [MSCanvasSaveDialog.Native]::IsChild([IntPtr] $Dialog.Current.NativeWindowHandle, $hostHandle)) {
    throw 'FileNameControlHost is not inside the exact owned save dialog.'
  }
  $matches = @([MSCanvasSaveDialog.Native]::OwnedControls([IntPtr] $Dialog.Current.NativeWindowHandle, $ApplicationProcessId) | Where-Object {
    $_.id -eq 1001 -and $_.className -ceq 'Edit' -and $_.visible -and
    [MSCanvasSaveDialog.Native]::IsChild($hostHandle, [IntPtr] $_.handle)
  })
  if ($matches.Count -gt 1) { throw 'The owned filename host has more than one matching native edit.' }
  $script:filenameLookup = 'exact native filename edit not found'
  if ($matches.Count -eq 0) { return $null }
  $editHandle = [IntPtr] $matches[0].handle
  $edit = [System.Windows.Automation.AutomationElement]::FromHandle($editHandle)
  if ($null -eq $edit -or $edit.Current.ProcessId -ne $ApplicationProcessId -or
      [IntPtr] $edit.Current.NativeWindowHandle -ne $editHandle) {
    throw 'The filename UIA bridge did not retain its verified native identity.'
  }
  Assert-OwnedControl -Dialog $Dialog -Control $edit -Id 1001
  $script:filenameLookup = 'exact native filename edit bridged to UIA'
  return $edit
}

function Find-ActionButton {
  param($Dialog, [string] $Id)
  if ($ApplicationProcessId -eq 0) { return Find-ById -Dialog $Dialog -AutomationId $Id }

  # File-list UIItems also expose automation IDs 1 and 2 with no native HWND.
  # Select the exact dialog's unique visible native Button by resource ID,
  # then bridge that HWND without accepting a same-ID virtual list item.
  $matches = @([MSCanvasSaveDialog.Native]::OwnedControls([IntPtr] $Dialog.Current.NativeWindowHandle, $ApplicationProcessId) | Where-Object {
    $_.id -eq [int] $Id -and $_.className -ceq 'Button' -and $_.visible
  })
  if ($matches.Count -gt 1) { throw 'More than one exact owned action button was found.' }
  if ($matches.Count -eq 0) { return $null }
  $handle = [IntPtr] $matches[0].handle
  $button = [System.Windows.Automation.AutomationElement]::FromHandle($handle)
  if ($null -eq $button -or $button.Current.ProcessId -ne $ApplicationProcessId -or
      [IntPtr] $button.Current.NativeWindowHandle -ne $handle) {
    throw 'The action button UIA bridge did not retain its verified native identity.'
  }
  Assert-OwnedControl -Dialog $Dialog -Control $button -Id ([int] $Id)
  $result.buttonLookup = 'exact native Button/resource ID bridged to UIA'
  return $button
}

function Get-OwnedControlEvidence {
  param($Dialog)
  $nativeControls = @([MSCanvasSaveDialog.Native]::OwnedControls([IntPtr] $Dialog.Current.NativeWindowHandle, $ApplicationProcessId))
  $uiaControls = @()
  foreach ($control in $Dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)) {
    if ($control.Current.ProcessId -ne $ApplicationProcessId) { continue }
    # Record identifiers and control classes only, never directory entries,
    # filename values or another application's UI.
    $uiaControls += [ordered]@{ id = $control.Current.AutomationId; className = $control.Current.ClassName; handle = $control.Current.NativeWindowHandle; enabled = $control.Current.IsEnabled }
  }
  return [ordered]@{ native = $nativeControls; uia = $uiaControls }
}

$result = [ordered]@{
  title    = $Title
  action   = $Action
  processId = $ApplicationProcessId
  found    = $false
  named    = $false
  invoked  = $false
  detail   = ''
  controlChecks = @()
}

$controlsDeadline = (Get-Date).AddSeconds($TimeoutSeconds)
$dialog = Find-Dialog -Name $Title -Seconds $TimeoutSeconds
if ($null -eq $dialog) {
  if ($ApplicationProcessId -ne 0) {
    $result.detail = "no exact owned native dialog titled '$Title' appeared within ${TimeoutSeconds}s"
    $result.appWindows = @([MSCanvasSaveDialog.Native]::OwnedWindows($ApplicationProcessId))
    $result | ConvertTo-Json -Depth 4 -Compress
    exit 2
  }
  # What was actually on screen, so a mismatch names the window it should have
  # matched instead of reporting only that nothing did.
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $windows = $root.FindAll(
    [System.Windows.Automation.TreeScope]::Children,
    [System.Windows.Automation.Condition]::TrueCondition)
  $titles = @()
  foreach ($window in $windows) {
    # Class name too, and unnamed windows included: a dialog with no title is
    # exactly the case that made an earlier version of this report useless.
    $titles += "$($window.Current.ClassName)|$($window.Current.Name)"
  }
  # Every window the shell knows about, including ones UI Automation does not
  # surface, with the process that owns it. This is what tells "no dialog was
  # ever created" apart from "a dialog exists and automation cannot see it".
  Add-Type -Namespace Probe -Name Win -MemberDefinition @'
    public delegate bool Enumerator(System.IntPtr hWnd, System.IntPtr lParam);
    [DllImport("user32.dll")] public static extern bool EnumWindows(Enumerator e, System.IntPtr l);
    [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(System.IntPtr h, out int pid);
    [DllImport("user32.dll", CharSet = CharSet.Unicode)] public static extern int GetClassName(System.IntPtr h, System.Text.StringBuilder s, int n);
    [DllImport("user32.dll")] public static extern bool IsWindowVisible(System.IntPtr h);
'@
  $raw = @()
  $collect = [Probe.Win+Enumerator] {
    param($handle, $lparam)
    $owner = 0
    [void] [Probe.Win]::GetWindowThreadProcessId($handle, [ref] $owner)
    $name = (Get-Process -Id $owner -ErrorAction SilentlyContinue).ProcessName
    if ($name -like '*mscanvas*') {
      $class = New-Object System.Text.StringBuilder 256
      [void] [Probe.Win]::GetClassName($handle, $class, 256)
      $script:raw += "$($class.ToString())|visible=$([Probe.Win]::IsWindowVisible($handle))"
    }
    return $true
  }
  [void] [Probe.Win]::EnumWindows($collect, [System.IntPtr]::Zero)

  $result.detail = "no top-level window named '$Title' appeared within ${TimeoutSeconds}s"
  $result.seen = $titles
  $result.appWindows = $raw
  $result | ConvertTo-Json -Compress
  exit 2
}
$result.found = $true
$result.dialogHandle = $dialog.Current.NativeWindowHandle
$result.lookup = if ($ApplicationProcessId -ne 0) { 'Win32 exact PID/title/class -> UIAutomation.FromHandle' } else { 'legacy UIAutomation root' }

if ($ApplicationProcessId -ne 0) {
  # Finding the dialog HWND does not establish that its controls are ready.
  # Use the remainder of the original lookup budget, not a second timeout.
  $ready = $false
  $buttonId = if ($Action -eq 'save') { '1' } else { '2' }
  do {
    $button = Find-ActionButton -Dialog $dialog -Id $buttonId
    $valuePattern = $null
    $edit = if ($Action -eq 'save') { Find-FileName -Dialog $dialog } else { $null }
    $hasValuePattern = $null -ne $edit -and $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref] $valuePattern)
    $result.readiness = [ordered]@{ filenameLookup = $script:filenameLookup; editFound = $null -ne $edit; valuePatternAvailable = $hasValuePattern; buttonFound = $null -ne $button; buttonEnabled = ($null -ne $button -and $button.Current.IsEnabled) }
    if ($null -ne $button -and $button.Current.IsEnabled -and ($Action -eq 'cancel' -or
        ($null -ne $edit -and $edit.Current.IsEnabled))) {
      $ready = $true
      break
    }
    Start-Sleep -Milliseconds 200
  } while ((Get-Date) -lt $controlsDeadline)
  if (-not $ready) {
    $result.detail = 'The exact owned filename/button controls did not become ready within the original lookup budget.'
    $result.controls = Get-OwnedControlEvidence -Dialog $dialog
    $result | ConvertTo-Json -Depth 5 -Compress
    exit 4
  }
}

if ($Action -eq 'save') {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    $result.detail = 'saving needs a destination'
    $result | ConvertTo-Json -Compress
    exit 3
  }
  # The file-name edit. Its own id, not its label: the label is localised and
  # the id is not.
  $edit = Find-FileName -Dialog $dialog
  if ($null -eq $edit) {
    $result.detail = 'The identified save dialog carried no matching filename edit.'
    $result | ConvertTo-Json -Compress
    exit 4
  }
  $editId = if ($ApplicationProcessId -ne 0) { 1001 } else { 1148 }
  Assert-OwnedControl -Dialog $dialog -Control $edit -Id $editId
  # The full path rather than a bare name, so the destination is this test's own
  # temporary directory rather than wherever the dialog last opened.
  $value = $null
  if ($ApplicationProcessId -eq 0 -or $edit.TryGetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern, [ref] $value)) {
    if ($null -eq $value) { $value = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern) }
    $value.SetValue($Path)
    $result.filenameEntryMethod = 'UIAutomation.Value'
  } else {
    # Run07 proved that the exact native Edit is available but ValuePattern is
    # absent. Write and read back its text through bounded, owned HWND messages.
    $hostControl = Find-ById -Dialog $dialog -AutomationId 'FileNameControlHost'
    [MSCanvasSaveDialog.Native]::EnterFilename([IntPtr] $dialog.Current.NativeWindowHandle, [IntPtr] $hostControl.Current.NativeWindowHandle, [IntPtr] $edit.Current.NativeWindowHandle, $ApplicationProcessId, $Path)
    $result.filenameEntryMethod = 'Win32.WM_SETTEXT with exact WM_GETTEXT readback'
    $result.filenameReadbackExact = $true
  }
  $result.named = $true
  $result.filenameControl = [ordered]@{ id = $editId; className = $edit.Current.ClassName; handle = $edit.Current.NativeWindowHandle; hostId = $(if ($ApplicationProcessId -ne 0) { 'FileNameControlHost' } else { 'legacy' }) }
}

$buttonId = if ($Action -eq 'save') { '1' } else { '2' }
$button = Find-ActionButton -Dialog $dialog -Id $buttonId
if ($null -eq $button) {
  $result.detail = "the dialog carried no control with automation id $buttonId"
  $result | ConvertTo-Json -Compress
  exit 5
}

Assert-OwnedControl -Dialog $dialog -Control $button -Id ([int] $buttonId)
$invoke = $null
if ($ApplicationProcessId -eq 0 -or $button.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern, [ref] $invoke)) {
  if ($null -eq $invoke) { $invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern) }
  $invoke.Invoke()
  $result.method = 'UIAutomation.Invoke'
} else {
  # The same native common-dialog button provider used by the acquisition
  # helper may omit InvokePattern. Activate only the already verified button.
  $messageResult = [UIntPtr]::Zero
  $sent = [MSCanvasSaveDialog.Native]::SendMessageTimeout([IntPtr] $button.Current.NativeWindowHandle, 0xF5, [UIntPtr]::Zero, [IntPtr]::Zero, 2, 5000, [ref] $messageResult)
  if ($sent -eq [IntPtr]::Zero) { throw 'The owned save button click timed out or failed.' }
  $result.method = 'Win32.BM_CLICK'
}
$result.invoked = $true
$result | ConvertTo-Json -Depth 4 -Compress
exit 0
