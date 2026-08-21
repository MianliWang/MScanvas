<#
.SYNOPSIS
  Waits for one of this application's save dialogs, describes it, and cancels it.

.DESCRIPTION
  The save dialog belongs to the operating system, not to the document, and no
  WebDriver session has authority over it. UI Automation does, and it is already
  present on every supported Windows installation -- so this adds no dependency
  to the repository.

  The window is found by its title, which the application itself chooses
  (`SaveDialogFacts::title`), and cancelled through the Cancel button's invoke
  pattern. Both the title and the button are named by the platform's own
  contract rather than by position, which is what makes this something other
  than a screen-scrape.

  Writes one JSON object to standard output: whether the dialog appeared, which
  controls were found on it, and whether it was cancelled. A caller that reads
  `found: false` learned that no dialog was shown, which is a real answer.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $Title,
  [int] $TimeoutSeconds = 30
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes

function Find-Dialog {
  param([string] $Name, [int] $Seconds)

  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $condition = New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::NameProperty, $Name)
  $deadline = (Get-Date).AddSeconds($Seconds)
  while ((Get-Date) -lt $deadline) {
    $found = $root.FindFirst(
      [System.Windows.Automation.TreeScope]::Children, $condition)
    if ($null -ne $found) { return $found }
    Start-Sleep -Milliseconds 200
  }
  return $null
}

$result = [ordered]@{
  title     = $Title
  found     = $false
  controls  = @()
  cancelled = $false
  detail    = ''
}

$dialog = Find-Dialog -Name $Title -Seconds $TimeoutSeconds
if ($null -eq $dialog) {
  $result.detail = "no top-level window named '$Title' appeared within ${TimeoutSeconds}s"
  $result | ConvertTo-Json -Compress
  exit 2
}

$result.found = $true

$buttons = $dialog.FindAll(
  [System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::ControlTypeProperty,
    [System.Windows.Automation.ControlType]::Button)))

$named = @()
foreach ($button in $buttons) {
  $named += [ordered]@{
    name         = $button.Current.Name
    automationId = $button.Current.AutomationId
  }
}
$result.controls = $named

# IDCANCEL. The automation id is the dialog resource's own, and is what makes
# this selector stable across display languages; the name is the fallback for a
# dialog that does not carry one.
$cancel = $dialog.FindFirst(
  [System.Windows.Automation.TreeScope]::Descendants,
  (New-Object System.Windows.Automation.PropertyCondition(
    [System.Windows.Automation.AutomationElement]::AutomationIdProperty, '2')))
if ($null -eq $cancel) {
  $cancel = $dialog.FindFirst(
    [System.Windows.Automation.TreeScope]::Descendants,
    (New-Object System.Windows.Automation.PropertyCondition(
      [System.Windows.Automation.AutomationElement]::NameProperty, 'Cancel')))
}

if ($null -eq $cancel) {
  $result.detail = 'the dialog carried no control with automation id 2 or name Cancel'
  $result | ConvertTo-Json -Compress
  exit 3
}

$invoke = $cancel.GetCurrentPattern(
  [System.Windows.Automation.InvokePattern]::Pattern)
$invoke.Invoke()
$result.cancelled = $true
$result | ConvertTo-Json -Compress
exit 0
