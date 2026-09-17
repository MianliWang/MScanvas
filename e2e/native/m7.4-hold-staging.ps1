<# Locks only an exact file created under this native run's staging output. #>
[CmdletBinding()]
param(
  [Parameter(Mandatory=$true)][string] $TaskRoot,
  [Parameter(Mandatory=$true)][string] $StagedPath,
  [Parameter(Mandatory=$true)][string] $Journal,
  [Parameter(Mandatory=$true)][string] $ReleaseSignal
)
$ErrorActionPreference = 'Stop'
$root = [IO.Path]::GetFullPath($TaskRoot).TrimEnd('\')
$target = [IO.Path]::GetFullPath($StagedPath)
foreach ($candidate in @($target, [IO.Path]::GetFullPath($Journal), [IO.Path]::GetFullPath($ReleaseSignal))) {
  if (-not $candidate.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'A lock artifact escaped its owned run.' }
}
if (-not (Test-Path -LiteralPath (Join-Path $root 'owned-run.json')) -or $target -notmatch '\.mscanvas-staging\\output\\[^\\]+\.mzML$') { throw 'The exact task-owned staging protocol is required.' }
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class M74StagingLock {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  public static SafeFileHandle WaitForFile(string path, string releaseSignal, int timeoutMilliseconds, out int attempts) {
    var timer = System.Diagnostics.Stopwatch.StartNew();
    attempts = 0;
    while (timer.ElapsedMilliseconds < timeoutMilliseconds && !System.IO.File.Exists(releaseSignal)) {
      attempts++;
      // GENERIC_READ, share READ|WRITE, no DELETE. The writer can finish;
      // publication and cleanup must report the exact file's real lock.
      var handle = CreateFileW(path, 0x80000000, 3, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
      if (!handle.IsInvalid) return handle;
      handle.Dispose();
      System.Threading.Thread.Sleep(1);
    }
    return null;
  }
}
'@
$record = [ordered]@{ kind='task-owned real staging lock'; processId=$PID; path=$target; armedUtc=[DateTime]::UtcNow.ToString('o'); held=$false; released=$false }
function Save-Record { $record | ConvertTo-Json | Set-Content -LiteralPath $Journal -Encoding UTF8 }
Save-Record
$deadline = [DateTime]::UtcNow.AddSeconds(90)
$held = $null
try {
  $attempts = 0
  $held = [M74StagingLock]::WaitForFile($target, $ReleaseSignal, 90000, [ref] $attempts)
  $record.openAttempts = $attempts
  if ($null -eq $held) { throw 'No exact staging file was locked within the bounded window.' }
  $node = Get-Item -LiteralPath $target
  while ($node -and $node.FullName.StartsWith($root, [StringComparison]::OrdinalIgnoreCase)) {
    if (($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'No reparse traversal in the lock helper.' }
    $node = if ($node -is [IO.DirectoryInfo]) { $node.Parent } else { $node.Directory }
  }
  $record.held=$true
  $record.heldUtc=[DateTime]::UtcNow.ToString('o')
  Save-Record
  while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $ReleaseSignal)) { Start-Sleep -Milliseconds 25 }
  if (-not (Test-Path -LiteralPath $ReleaseSignal)) { throw 'The bounded lock expired before explicit release.' }
} finally {
  if ($null -ne $held) { $held.Dispose(); $record.released=$true; $record.releasedUtc=[DateTime]::UtcNow.ToString('o') }
  Save-Record
}
