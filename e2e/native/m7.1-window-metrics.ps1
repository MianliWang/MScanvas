<# Read the attributed test window's actual Windows DPI and foreground owner. #>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int] $ApplicationProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace M71Window -Name Native -MemberDefinition @'
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr window, out int processId);
'@
$application = Get-Process -Id $ApplicationProcessId
if ($application.ProcessName -ne 'mscanvas-desktop' -or $application.MainWindowHandle -eq [IntPtr]::Zero) {
  throw 'The identified process has no MSCanvas main window.'
}
$foreground = [M71Window.Native]::GetForegroundWindow()
$foregroundOwner = 0
[void] [M71Window.Native]::GetWindowThreadProcessId($foreground, [ref] $foregroundOwner)
[ordered]@{
  processId = $ApplicationProcessId
  executable = $application.Path
  mainWindow = $application.MainWindowHandle.ToInt64()
  dpi = [M71Window.Native]::GetDpiForWindow($application.MainWindowHandle)
  foregroundWindow = $foreground.ToInt64()
  foregroundProcessId = $foregroundOwner
  measuredUtc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Compress
