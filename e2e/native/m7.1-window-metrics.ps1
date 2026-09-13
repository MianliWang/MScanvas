<# Read the attributed test window's actual Windows DPI and foreground owner. #>
[CmdletBinding()]
param([Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int] $ApplicationProcessId)
$ErrorActionPreference = 'Stop'
Add-Type -Namespace M71Window -Name Native -MemberDefinition @'
  [DllImport("user32.dll")] public static extern uint GetDpiForWindow(IntPtr window);
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern int GetWindowThreadProcessId(IntPtr window, out int processId);
  [StructLayout(LayoutKind.Sequential)] public struct Rect { public int left, top, right, bottom; }
  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct MonitorInfo { public int size; public Rect monitor, workArea; public uint flags; }
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll")] static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool GetClientRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] static extern bool ClientToScreen(IntPtr window, ref Point point);
  [DllImport("user32.dll")] static extern IntPtr MonitorFromWindow(IntPtr window, uint flags);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] static extern bool GetMonitorInfo(IntPtr monitor, ref MonitorInfo info);
  [DllImport("dwmapi.dll")] static extern int DwmGetWindowAttribute(IntPtr window, int attribute, out Rect rect, int size);
  [DllImport("user32.dll")] public static extern bool IsZoomed(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  public sealed class WindowBounds {
    public Rect window, client, visibleFrame, monitor, workArea;
    public Point clientScreenOrigin;
    public bool visibleFrameInsideWorkArea;
  }
  public static WindowBounds ReadBounds(IntPtr window) {
    // Only the observer thread uses physical coordinates; restore its previous
    // context. This does not change the app or any display/system DPI setting.
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    if (previous == IntPtr.Zero) throw new InvalidOperationException("Observer DPI context was unavailable.");
    try {
      var result = new WindowBounds();
      var info = new MonitorInfo { size = Marshal.SizeOf(typeof(MonitorInfo)) };
      if (!GetWindowRect(window, out result.window) || !GetClientRect(window, out result.client)
          || !ClientToScreen(window, ref result.clientScreenOrigin)
          || !GetMonitorInfo(MonitorFromWindow(window, 2), ref info)
          || DwmGetWindowAttribute(window, 9, out result.visibleFrame, Marshal.SizeOf(typeof(Rect))) != 0)
        throw new InvalidOperationException("Owned window bounds could not be read.");
      result.monitor = info.monitor;
      result.workArea = info.workArea;
      result.visibleFrameInsideWorkArea = result.visibleFrame.left >= info.workArea.left
        && result.visibleFrame.top >= info.workArea.top && result.visibleFrame.right <= info.workArea.right
        && result.visibleFrame.bottom <= info.workArea.bottom;
      return result;
    } finally { SetThreadDpiAwarenessContext(previous); }
  }
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
  boundsCoordinateSpace = 'physical pixels; observer thread only'
  bounds = [M71Window.Native]::ReadBounds($application.MainWindowHandle)
  maximized = [M71Window.Native]::IsZoomed($application.MainWindowHandle)
  minimized = [M71Window.Native]::IsIconic($application.MainWindowHandle)
  measuredUtc = [DateTime]::UtcNow.ToString('o')
} | ConvertTo-Json -Depth 5 -Compress
