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

    1148  the file-name edit
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
  [int] $TimeoutSeconds = 60
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

function Find-Dialog {
  param([string] $Name, [int] $Seconds)

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
    if ($null -ne $found) { return $found }

    $windows = $root.FindAll(
      [System.Windows.Automation.TreeScope]::Children,
      [System.Windows.Automation.Condition]::TrueCondition)
    foreach ($window in $windows) {
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

$result = [ordered]@{
  title    = $Title
  action   = $Action
  found    = $false
  named    = $false
  invoked  = $false
  detail   = ''
}

$dialog = Find-Dialog -Name $Title -Seconds $TimeoutSeconds
if ($null -eq $dialog) {
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

if ($Action -eq 'save') {
  if ([string]::IsNullOrWhiteSpace($Path)) {
    $result.detail = 'saving needs a destination'
    $result | ConvertTo-Json -Compress
    exit 3
  }
  # The file-name edit. Its own id, not its label: the label is localised and
  # the id is not.
  $edit = Find-ById -Dialog $dialog -AutomationId '1148'
  if ($null -eq $edit) {
    $result.detail = 'the dialog carried no control with automation id 1148'
    $result | ConvertTo-Json -Compress
    exit 4
  }
  $value = $edit.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern)
  # The full path rather than a bare name, so the destination is this test's own
  # temporary directory rather than wherever the dialog last opened.
  $value.SetValue($Path)
  $result.named = $true
}

$buttonId = if ($Action -eq 'save') { '1' } else { '2' }
$button = Find-ById -Dialog $dialog -AutomationId $buttonId
if ($null -eq $button) {
  $result.detail = "the dialog carried no control with automation id $buttonId"
  $result | ConvertTo-Json -Compress
  exit 5
}

$invoke = $button.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
$result.invoked = $true
$result | ConvertTo-Json -Compress
exit 0
