<#
.SYNOPSIS
  Gives one newly launched owned application window the foreground, once, with
  a real mouse click and no manual step.

.DESCRIPTION
  M7.5 proves things about Windows focus: that a native folder chooser returns
  to the action that opened it, that a dialog's focus trap is real, that a
  restarted application restores a stored preference while its own window has
  the keyboard. None of that is observable in a window that has never been
  foreground, and a WebDriver session never activates the application it drives.

  M7.4 asked the operator to click the window once. This does it instead:

    1. the exact owned window is raised temporarily above other windows, so the
       click cannot land on something else;
    2. the caption is hit-tested, so the click cannot land on web content,
       and the click point's owner is checked to be this same process;
    3. one left click is sent at that point, with the cursor put back where it
       was;
    4. the window is returned to ordinary Z order before anything else happens.

  A click, not `SetForegroundWindow`: activation by click is the condition a
  real use has, and Windows grants it to a background process where it refuses
  the API call. Topmost is a setup state, not a test state -- a window pinned
  above everything would hide exactly the overlap a layout scenario is looking
  for -- so it is cleared here, and the readback below fails the run rather than
  leaving it pinned.

  This helper refuses rather than improvises. It does not retry, does not move
  or resize the window, does not minimise or maximise it, and does not touch
  any window this run did not launch.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][ValidateRange(1, 2147483647)][int] $ApplicationProcessId
)
$ErrorActionPreference = 'Stop'

$before = & (Join-Path $PSScriptRoot 'm7.1-window-metrics.ps1') -ApplicationProcessId $ApplicationProcessId | ConvertFrom-Json
$expectedExecutable = (Resolve-Path -LiteralPath (Join-Path $PSScriptRoot '../../target/e2e/release/mscanvas-desktop.exe')).Path
if (-not [String]::Equals($before.executable, $expectedExecutable, [StringComparison]::OrdinalIgnoreCase)) {
  throw 'Activation is only ever applied to this run''s own built application.'
}
if ($before.minimized -or $before.maximized -or -not $before.bounds.visibleFrameInsideWorkArea) {
  throw 'Activation requires the owned window visible in its normal state.'
}

Add-Type -Namespace M75Activate -Name Native -MemberDefinition @'
  [DllImport("user32.dll")] static extern IntPtr SetThreadDpiAwarenessContext(IntPtr context);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetWindowPos(IntPtr window, IntPtr after, int x, int y, int width, int height, uint flags);
  [DllImport("user32.dll")] static extern IntPtr WindowFromPoint(Point point);
  [DllImport("user32.dll")] static extern int GetWindowThreadProcessId(IntPtr window, out int processId);
  [DllImport("user32.dll")] static extern IntPtr SendMessageTimeout(IntPtr window, uint message, IntPtr wparam, IntPtr lparam, uint flags, uint timeout, out IntPtr result);
  [DllImport("user32.dll")] static extern bool GetCursorPos(out Point point);
  [DllImport("user32.dll", SetLastError = true)] static extern bool SetCursorPos(int x, int y);
  [DllImport("user32.dll", SetLastError = true)] static extern uint SendInput(uint count, Input[] inputs, int size);
  [DllImport("user32.dll")] static extern int GetWindowLong(IntPtr window, int index);

  [StructLayout(LayoutKind.Sequential)] public struct Point { public int x, y; }
  [StructLayout(LayoutKind.Sequential)] public struct MouseInput { public int dx, dy; public uint mouseData, flags, time; public IntPtr extra; }
  [StructLayout(LayoutKind.Sequential)] public struct Input { public uint type; public MouseInput mouse; }

  public sealed class Activation {
    public int clickX, clickY, pointOwnerProcessId, captionHitTest, cursorEvents;
    public long pointWindow;
    public bool topmostApplied, clicked, topmostCleared, cursorRestored, topmostAfter;
  }

  /// One click on the caption of exactly this window, and nothing else.
  public static Activation Perform(IntPtr window, int processId, int x, int y) {
    var result = new Activation { clickX = x, clickY = y };
    IntPtr previous = SetThreadDpiAwarenessContext(new IntPtr(-4));
    if (previous == IntPtr.Zero) throw new InvalidOperationException("Activation coordinate context was unavailable.");
    bool topmost = false;
    try {
      int owner;
      GetWindowThreadProcessId(window, out owner);
      if (owner != processId) throw new InvalidOperationException("Activation ownership changed.");

      // HWND_TOPMOST, keeping position, size and activation: the click has to
      // reach this window even if another one currently covers the point.
      if (!SetWindowPos(window, new IntPtr(-1), 0, 0, 0, 0, 0x0013))
        throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      topmost = result.topmostApplied = true;

      var point = new Point { x = x, y = y };
      IntPtr atPoint = WindowFromPoint(point);
      result.pointWindow = atPoint.ToInt64();
      int atPointOwner;
      GetWindowThreadProcessId(atPoint, out atPointOwner);
      result.pointOwnerProcessId = atPointOwner;
      if (atPointOwner != processId) throw new InvalidOperationException("The activation point is not owned by this application.");

      // WM_NCHITTEST; HTCAPTION is 2. A point that hit-tests anywhere else --
      // the client area, a resize border, a caption button -- is not neutral,
      // and this refuses instead of clicking it.
      // Bounded and abandoned if the window is hung: a query for the caption
      // must not become an indefinite wait on another process's message loop.
      IntPtr hit;
      if (SendMessageTimeout(window, 0x0084, IntPtr.Zero, new IntPtr(((y & 0xFFFF) << 16) | (x & 0xFFFF)), 0x0002, 5000, out hit) == IntPtr.Zero)
        throw new InvalidOperationException("The owned window did not answer a caption hit test.");
      result.captionHitTest = (int) hit;
      if (result.captionHitTest != 2) throw new InvalidOperationException("The activation point does not hit-test as the window caption.");

      Point restore;
      if (!GetCursorPos(out restore)) throw new InvalidOperationException("The cursor position could not be read.");
      if (!SetCursorPos(x, y)) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      var click = new Input[2];
      click[0].mouse.flags = 0x0002; // LEFTDOWN, at the cursor: no movement event.
      click[1].mouse.flags = 0x0004; // LEFTUP. Exactly one press, so no drag and no double click.
      result.cursorEvents = (int) SendInput(2, click, Marshal.SizeOf(typeof(Input)));
      if (result.cursorEvents != 2) throw new System.ComponentModel.Win32Exception(Marshal.GetLastWin32Error());
      result.clicked = true;
      result.cursorRestored = SetCursorPos(restore.x, restore.y);
    } finally {
      if (topmost) {
        // HWND_NOTOPMOST. Before any business action, and in a finally so a
        // refusal above does not leave the window pinned.
        result.topmostCleared = SetWindowPos(window, new IntPtr(-2), 0, 0, 0, 0, 0x0013);
      }
      SetThreadDpiAwarenessContext(previous);
    }
    if (!result.topmostCleared) throw new InvalidOperationException("The owned window could not be returned to ordinary Z order.");
    // WS_EX_TOPMOST, read back and reported. The throw is the guarantee; the
    // field is what a reader of the evidence can check it against, so it holds
    // the reading rather than a constant that could not be anything else.
    result.topmostAfter = (GetWindowLong(window, -20) & 0x00000008) != 0;
    if (result.topmostAfter) throw new InvalidOperationException("The owned window is still topmost.");
    return result;
  }
'@

# The caption strip: between the window frame's top and the client origin,
# across the middle of the width. Away from the system menu on the left and the
# caption buttons on the right, and above every pixel the page owns.
$bounds = $before.bounds
$captionTop = $bounds.window.top
$captionBottom = $bounds.clientScreenOrigin.y
if (($captionBottom - $captionTop) -lt 8) { throw 'The owned window has no caption strip to click.' }
$x = [int] [Math]::Round($bounds.window.left + ($bounds.window.right - $bounds.window.left) * 0.45)
$y = [int] [Math]::Round(($captionTop + $captionBottom) / 2)

$activation = [M75Activate.Native]::Perform([IntPtr] $before.mainWindow, $ApplicationProcessId, $x, $y)

$deadline = [DateTime]::UtcNow.AddSeconds(20)
$after = $null
while ([DateTime]::UtcNow -lt $deadline) {
  $after = & (Join-Path $PSScriptRoot 'm7.1-window-metrics.ps1') -ApplicationProcessId $ApplicationProcessId | ConvertFrom-Json
  if ($after.foregroundProcessId -eq $ApplicationProcessId) { break }
  Start-Sleep -Milliseconds 100
}
if ($null -eq $after -or $after.foregroundProcessId -ne $ApplicationProcessId) {
  throw 'One neutral activation click did not put the owned window in the foreground.'
}
if ($after.minimized -or $after.maximized -or
    $after.bounds.window.left -ne $bounds.window.left -or $after.bounds.window.top -ne $bounds.window.top -or
    $after.bounds.window.right -ne $bounds.window.right -or $after.bounds.window.bottom -ne $bounds.window.bottom) {
  throw 'Activation changed the owned window''s placement or state.'
}

[ordered]@{
  processId = $ApplicationProcessId
  mainWindow = $before.mainWindow
  method = 'temporary HWND_TOPMOST; one WM_NCHITTEST-confirmed caption SendInput click; HWND_NOTOPMOST'
  activation = $activation
  foregroundProcessId = $after.foregroundProcessId
  topmostAfter = $activation.topmostAfter
  activatedUtc = [DateTime]::UtcNow.ToString('o')
  before = $before
  after = $after
} | ConvertTo-Json -Depth 7 -Compress
