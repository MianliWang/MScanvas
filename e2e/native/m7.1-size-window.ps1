<# Size only the attributed QA application's real client area, once at setup. #>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int] $ApplicationProcessId,
  [Parameter(Mandatory = $true)][ValidateSet(96, 120, 144, 192)][int] $ExpectedDpi,
  [Parameter(Mandatory = $true)][ValidateRange(1, 1920)][int] $CssWidth,
  [Parameter(Mandatory = $true)][ValidateRange(1, 1080)][int] $CssHeight
)
$ErrorActionPreference = 'Stop'
$before = & (Join-Path $PSScriptRoot 'm7.1-window-metrics.ps1') -ApplicationProcessId $ApplicationProcessId | ConvertFrom-Json
$expectedExecutable = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../target/e2e/release/mscanvas-desktop.exe')).Path
if (-not [String]::Equals($before.executable, $expectedExecutable, [StringComparison]::OrdinalIgnoreCase) -or
    $before.dpi -ne $ExpectedDpi -or $before.foregroundProcessId -ne $ApplicationProcessId -or
    $before.maximized -or $before.minimized) {
  throw 'Sizing requires the exact foreground QA window at the requested DPI in its normal state.'
}

$clientWidth = [int] [Math]::Round($CssWidth * $ExpectedDpi / 96)
$clientHeight = [int] [Math]::Round($CssHeight * $ExpectedDpi / 96)
$bounds = $before.bounds
$width = $clientWidth + ($bounds.window.right - $bounds.window.left) - ($bounds.client.right - $bounds.client.left)
$height = $clientHeight + ($bounds.window.bottom - $bounds.window.top) - ($bounds.client.bottom - $bounds.client.top)
$work = $bounds.workArea
if ($width -gt ($work.right - $work.left) -or $height -gt ($work.bottom - $work.top)) {
  throw 'The requested native client size does not fit the current monitor work area.'
}
$left = [Math]::Max($work.left, [Math]::Min($bounds.window.left, $work.right - $width))
$top = [Math]::Max($work.top, [Math]::Min($bounds.window.top, $work.bottom - $height))

Add-Type -Namespace M71Window -Name Sizing -MemberDefinition @'
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr window, out int processId);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  public static void Apply(IntPtr window, int processId, int x, int y, int width, int height) {
    int owner;
    GetWindowThreadProcessId(window, out owner);
    if (owner != processId) throw new InvalidOperationException("Native sizing ownership changed.");
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    if (previous == IntPtr.Zero) throw new InvalidOperationException("Sizing coordinate context was unavailable.");
    try {
      // Preserve activation and both owner/window Z order. No foreground rescue.
      if (!SetWindowPos(window, IntPtr.Zero, x, y, width, height, 0x0214))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
    } finally { SetThreadDpiAwarenessContext(previous); }
  }
'@

$window = [IntPtr] $before.mainWindow
[M71Window.Sizing]::Apply($window, $ApplicationProcessId, $left, $top, $width, $height)
$after = [M71Window.Native]::ReadBounds($window)
if (($after.client.right - $after.client.left) -ne $clientWidth -or
    ($after.client.bottom - $after.client.top) -ne $clientHeight -or
    -not $after.visibleFrameInsideWorkArea -or [M71Window.Native]::GetDpiForWindow($window) -ne $ExpectedDpi) {
  throw 'Native sizing readback did not establish the requested visible client area.'
}
[ordered]@{
  processId = $ApplicationProcessId
  mainWindow = $before.mainWindow
  expectedDpi = $ExpectedDpi
  requestedCss = @{ width = $CssWidth; height = $CssHeight }
  requestedClientPixels = @{ width = $clientWidth; height = $clientHeight }
  method = 'Win32.SetWindowPos; NOACTIVATE|NOZORDER|NOOWNERZORDER; one setup call'
  before = $before
  after = $after
} | ConvertTo-Json -Depth 7 -Compress
