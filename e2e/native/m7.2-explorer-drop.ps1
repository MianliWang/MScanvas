<# Real Explorer selection and Windows mouse input; no synthetic drop payload. #>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int] $ApplicationProcessId,
  [Parameter(Mandatory = $true)][int] $TargetCssX,
  [Parameter(Mandatory = $true)][int] $TargetCssY,
  [Parameter(Mandatory = $true)][ValidateRange(96, 480)][int] $ExpectedDpi
)
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
Add-Type -AssemblyName UIAutomationClient, UIAutomationTypes, System.Windows.Forms
Add-Type -Namespace M72Explorer -Name Native -MemberDefinition @'
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Placement { public uint length, flags, show; public Point min, max; public Rect normal; }
  [StructLayout(LayoutKind.Sequential)] public struct Mouse { public int x, y; public uint data, flags, time; public UIntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public Mouse mouse; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr window, out int processId);
  [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr window, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr window, int command);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool GetWindowPlacement(IntPtr window, ref Placement placement);
  [DllImport("user32.dll")] public static extern bool SetWindowPlacement(IntPtr window, ref Placement placement);
  [DllImport("user32.dll")] public static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] public static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] public static extern short GetAsyncKeyState(int key);
  [DllImport("user32.dll")] static extern int GetSystemMetrics(int index);
  [DllImport("user32.dll", SetLastError=true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  public static Point At(int x, int y) { return new Point { x = x, y = y }; }
  public static void MouseInput(int x, int y, uint button) {
    int left = GetSystemMetrics(76), top = GetSystemMetrics(77);
    int width = GetSystemMetrics(78), height = GetSystemMetrics(79);
    if (x < left || x >= left + width || y < top || y >= top + height)
      throw new InvalidOperationException("The mouse point is outside the measured desktop.");
    var input = new Input { mouse = new Mouse {
      x = (int)Math.Round((x - left) * 65535.0 / (width - 1)),
      y = (int)Math.Round((y - top) * 65535.0 / (height - 1)),
      flags = 0xC001u | button
    }};
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) != 1)
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Owned Explorer input was refused.");
  }
  public static void ReleaseMouse() {
    var input = new Input { mouse = new Mouse { flags = 4 } };
    if (SendInput(1, new[] { input }, Marshal.SizeOf(typeof(Input))) != 1)
      throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error(), "Owned drag button release was refused.");
  }
'@
$result = [ordered]@{ kind = 'actual Explorer OS drag'; processId = $ApplicationProcessId; selectedPaths = @(); inputMethod = 'ShellFolderView.SelectItem + Windows SendInput'; dropped = $false; detail = '' }
$explorer = $null; $mouseHeld = $false; $previousDpi = [IntPtr]::Zero; $windowChanged = $false
$placement = New-Object M72Explorer.Native+Placement
$placement.length = [System.Runtime.InteropServices.Marshal]::SizeOf($placement)
$originalSelection = @()
function Fixture-Hash([string] $Path) {
  $sha = [System.Security.Cryptography.SHA256]::Create()
  try { return [BitConverter]::ToString($sha.ComputeHash([IO.File]::ReadAllBytes($Path))).Replace('-', '').ToLowerInvariant() }
  finally { $sha.Dispose() }
}
function Assert-RootAt([int] $X, [int] $Y, [IntPtr] $Window) {
  $root = [M72Explorer.Native]::GetAncestor([M72Explorer.Native]::WindowFromPoint([M72Explorer.Native]::At($X, $Y)), 2)
  if ($root -ne $Window) { throw 'The measured input point is obscured or belongs to another window.' }
}
try {
  $repoRoot = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../..')).Path
  $application = Get-Process -Id $ApplicationProcessId
  $binary = (Resolve-Path -LiteralPath (Join-Path $repoRoot 'target/e2e/release/mscanvas-desktop.exe')).Path
  if ($application.ProcessName -ne 'mscanvas-desktop' -or $application.Path -ne $binary -or $application.MainWindowHandle -eq [IntPtr]::Zero) { throw 'The supplied process is not the owned QA executable.' }
  $metrics = & (Join-Path $PSScriptRoot 'm7.1-window-metrics.ps1') -ApplicationProcessId $ApplicationProcessId | ConvertFrom-Json
  if ($metrics.dpi -ne $ExpectedDpi -or -not $metrics.bounds.visibleFrameInsideWorkArea) { throw 'The owned native geometry does not match this run.' }
  $result.application = $metrics
  $sourceFolder = (Resolve-Path -LiteralPath (Join-Path $repoRoot '.tmp/m72-evidence/native-inputs/TaskDrop')).Path
  $expectedPaths = @((Join-Path $sourceFolder 'M72-file-drop.mzML'), (Join-Path $sourceFolder 'M72-folder-drop'))
  $files = @((Join-Path $sourceFolder 'M72-file-drop.mzML'), (Join-Path $sourceFolder 'M72-folder-drop/M72-folder-a.mzML'), (Join-Path $sourceFolder 'M72-folder-drop/M72-folder-b.mzML'))
  foreach ($file in $files) {
    if ((Fixture-Hash $file) -ne 'a1228c104790670515f948f523dfe43caa7085cedb7d57d19ed07cbca5775ea7') { throw 'A prescribed drop fixture changed.' }
  }
  $shell = New-Object -ComObject Shell.Application
  $matches = @($shell.Windows() | Where-Object { try { $_.Document.Folder.Self.Path -eq $sourceFolder } catch { $false } })
  if ($matches.Count -ne 1) { throw 'Exactly one Explorer window for the prescribed task folder is required.' }
  $explorer = $matches[0]; $explorerWindow = [IntPtr] $explorer.HWND
  $explorerOwner = 0; [void] [M72Explorer.Native]::GetWindowThreadProcessId($explorerWindow, [ref] $explorerOwner)
  if ((Get-Process -Id $explorerOwner).ProcessName -ne 'explorer') { throw 'The source view is not Windows Explorer.' }
  if ([M72Explorer.Native]::GetAncestor($explorerWindow, 2) -ne $explorerWindow) { throw 'The Explorer handle is not a top-level window.' }
  $originalSelection = @($explorer.Document.SelectedItems() | ForEach-Object { $_.Path })
  $previousDpi = [M72Explorer.Native]::SetThreadDpiAwarenessContext([IntPtr](-4))
  if ($previousDpi -eq [IntPtr]::Zero) { throw 'The input observer DPI context is unavailable.' }
  if (-not [M72Explorer.Native]::GetWindowPlacement($explorerWindow, [ref] $placement)) { throw 'The original Explorer placement is unavailable.' }
  $right = $metrics.bounds.window.right + 20; $top = $metrics.bounds.workArea.top + 40
  $width = [Math]::Min(1300, $metrics.bounds.workArea.right - $right - 20)
  $height = [Math]::Min(1100, $metrics.bounds.workArea.bottom - $top - 20)
  if ($width -lt 800 -or $height -lt 600) { throw 'No unobscured side-by-side Explorer area is available on the current monitor.' }
  $windowChanged = $true
  [void] [M72Explorer.Native]::ShowWindow($explorerWindow, 9)
  if (-not [M72Explorer.Native]::SetWindowPos($explorerWindow, [IntPtr]::Zero, $right, $top, $width, $height, 0x14)) { throw 'The task Explorer window could not be positioned.' }
  [void] [M72Explorer.Native]::SetForegroundWindow($explorerWindow)
  Start-Sleep -Milliseconds 300
  if ([M72Explorer.Native]::GetForegroundWindow() -ne $explorerWindow) { throw 'Input refused because the exact task Explorer window is not foreground.' }
  $fileItem = $explorer.Document.Folder.ParseName('M72-file-drop.mzML')
  $folderItem = $explorer.Document.Folder.ParseName('M72-folder-drop')
  $explorer.Document.SelectItem($fileItem, 29)
  $explorer.Document.SelectItem($folderItem, 1)
  Start-Sleep -Milliseconds 200
  $selected = @($explorer.Document.SelectedItems() | ForEach-Object { $_.Path })
  if ($selected.Count -ne 2 -or @(Compare-Object ($expectedPaths | Sort-Object) ($selected | Sort-Object)).Count -ne 0) { throw 'Explorer selection does not match the exact file/folder payload.' }
  $result.selectedPaths = $selected; $result.explorerWindow = $explorerWindow.ToInt64(); $result.explorerProcessId = $explorerOwner
  $root = [System.Windows.Automation.AutomationElement]::FromHandle($explorerWindow)
  $name = New-Object System.Windows.Automation.PropertyCondition([System.Windows.Automation.AutomationElement]::NameProperty, $fileItem.Name)
  $items = @($root.FindAll([System.Windows.Automation.TreeScope]::Descendants, $name) | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem -or $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::DataItem })
  if ($items.Count -ne 1 -or $items[0].Current.IsOffscreen) { throw 'The exact visible Explorer source item could not be identified.' }
  $sourceRect = $items[0].Current.BoundingRectangle
  $sourceX = [int]($sourceRect.Left + [Math]::Min(100, $sourceRect.Width / 2)); $sourceY = [int]($sourceRect.Top + $sourceRect.Height / 2)
  $targetX = [int]($metrics.bounds.clientScreenOrigin.x + $TargetCssX * $ExpectedDpi / 96)
  $targetY = [int]($metrics.bounds.clientScreenOrigin.y + $TargetCssY * $ExpectedDpi / 96)
  if ($TargetCssX -lt 0 -or $TargetCssY -lt 0 -or $TargetCssX * $ExpectedDpi / 96 -ge $metrics.bounds.client.right -or $TargetCssY * $ExpectedDpi / 96 -ge $metrics.bounds.client.bottom) { throw 'The requested target is outside the owned client.' }
  Assert-RootAt $sourceX $sourceY $explorerWindow
  Assert-RootAt $targetX $targetY $application.MainWindowHandle
  if ([M72Explorer.Native]::GetForegroundWindow() -ne $explorerWindow) { throw 'The Explorer foreground changed before pickup.' }
  foreach ($key in @(1, 2, 4, 16, 17, 18, 91, 92)) { if (([M72Explorer.Native]::GetAsyncKeyState($key) -band 0x8000) -ne 0) { throw 'Existing human mouse/key input prevents an isolated drag.' } }
  $result.source = @{ x = $sourceX; y = $sourceY }; $result.target = @{ x = $targetX; y = $targetY; cssX = $TargetCssX; cssY = $TargetCssY }
  [M72Explorer.Native]::MouseInput($sourceX, $sourceY, 0)
  [M72Explorer.Native]::MouseInput($sourceX, $sourceY, 2); $mouseHeld = $true
  for ($step = 1; $step -le 20; $step++) {
    [M72Explorer.Native]::MouseInput([int]($sourceX + ($targetX - $sourceX) * $step / 20), [int]($sourceY + ($targetY - $sourceY) * $step / 20), 0)
    Start-Sleep -Milliseconds 30
  }
  Start-Sleep -Milliseconds 250
  Assert-RootAt $targetX $targetY $application.MainWindowHandle
  [M72Explorer.Native]::MouseInput($targetX, $targetY, 4); $mouseHeld = $false
  $result.dropped = $true
  foreach ($file in $files) {
    if ((Fixture-Hash $file) -ne 'a1228c104790670515f948f523dfe43caa7085cedb7d57d19ed07cbca5775ea7') { throw 'A drop fixture was changed or moved.' }
  }
} catch { $result.detail = $_.Exception.Message }
finally {
  if ($mouseHeld) {
    try {
      # Abort only in an owned foreground. A foreign foreground requires human
      # Escape; releasing at old coordinates could commit to an unrelated app.
      $foreground = [M72Explorer.Native]::GetForegroundWindow()
      if ($foreground -ne $explorerWindow -and $foreground -ne $application.MainWindowHandle) { throw 'The held drag cannot be cancelled in an owned foreground.' }
      [System.Windows.Forms.SendKeys]::SendWait('{ESC}')
      [M72Explorer.Native]::ReleaseMouse(); $mouseHeld = $false
      $result.failureDragCancelled = $true
    } catch { $result.detail += ' Drag cleanup stopped: ' + $_.Exception.Message }
    if ($mouseHeld) { $result.manualRecoveryRequired = 'Press Escape, then release the left mouse button; no unverified drop was sent.' }
  }
  if ($windowChanged -and -not $mouseHeld) {
    try {
      foreach ($item in @($explorer.Document.SelectedItems())) { $explorer.Document.SelectItem($item, 0) }
      foreach ($path in $originalSelection) { $explorer.Document.SelectItem($explorer.Document.Folder.ParseName([IO.Path]::GetFileName($path)), 1) }
      if ($placement.show -eq 2) { $placement.show = 7 }
      elseif ($placement.show -eq 1) { $placement.show = 4 }
      if (-not [M72Explorer.Native]::SetWindowPlacement($explorerWindow, [ref] $placement)) { throw 'The original Explorer placement could not be restored.' }
    } catch { $result.detail += ' Explorer restoration failed: ' + $_.Exception.Message }
  }
  if ($previousDpi -ne [IntPtr]::Zero) { [void] [M72Explorer.Native]::SetThreadDpiAwarenessContext($previousDpi) }
  $result | ConvertTo-Json -Depth 8 -Compress
}
if ($result.detail -ne '' -or -not $result.dropped) { exit 1 }
exit 0
