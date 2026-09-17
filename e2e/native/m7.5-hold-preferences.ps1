<#
.SYNOPSIS
  Makes Windows genuinely refuse to replace one preference record -- the one in
  this campaign's own isolated root, and no other.

.DESCRIPTION
  M7.5 has to show what the application does when it cannot save: that the old
  record survives byte for byte, that the draft is kept, that Retry, Cancel and
  "Use for this session" are all reachable, and that nothing claims a save that
  did not happen. Simulating that from inside the application would prove only
  that a simulation works.

  So this produces the real condition instead. It opens the published record for
  reading with `FILE_SHARE_READ` -- read sharing, and deliberately neither write
  nor delete sharing. The application's writer creates its private sibling and
  then asks the filesystem to replace the published name; that replacement needs
  to delete what is there, which this handle forbids, so the kernel refuses it.
  The application can still *read* the record while the hold is on, which is
  what its own reader does.

  It is the same condition the store's own Rust test creates in-process, seen
  from outside the process this time, against the compiled build.

  ## What it will not touch

  The operator's real configuration. The root has to be one of this campaign's
  own `preference-root-*` directories under the repository's ignored evidence
  area, the file has to be exactly the published name inside it, and no part of
  the path may be a reparse point. Anything else is a refusal before a handle is
  opened. The file must already exist: this helper never creates, truncates,
  writes or deletes a preference record -- it holds one open and lets go.

  The hold is bounded. It expires on its own if the release signal never
  arrives, so a failed scenario cannot leave a file locked behind it.
#>
[CmdletBinding()]
param(
  [Parameter(Mandatory = $true)][string] $PreferenceRoot,
  [Parameter(Mandatory = $true)][string] $Journal,
  [Parameter(Mandatory = $true)][string] $ReleaseSignal,
  [ValidateRange(5, 240)][int] $LifetimeSeconds = 120
)
$ErrorActionPreference = 'Stop'

$evidence = [IO.Path]::GetFullPath((Join-Path $PSScriptRoot '../../.tmp/m75-evidence')).TrimEnd('\')
$root = [IO.Path]::GetFullPath($PreferenceRoot).TrimEnd('\')
foreach ($candidate in @($root, [IO.Path]::GetFullPath($Journal), [IO.Path]::GetFullPath($ReleaseSignal))) {
  if (-not $candidate.StartsWith($evidence + '\', [StringComparison]::OrdinalIgnoreCase)) {
    throw 'A preference hold artifact escaped this campaign''s own evidence area.'
  }
}
if ((Split-Path -Leaf $root) -notlike 'preference-root-*') {
  throw 'Only a root this campaign created may be held.'
}
# This helper writes exactly one thing -- its journal -- and that may never be
# the record. Checked rather than left to the caller: the containment rules
# above would accept a journal path that *is* the published name, and
# Save-Record would then truncate the record being held open.
foreach ($taskArtifact in @([IO.Path]::GetFullPath($Journal), [IO.Path]::GetFullPath($ReleaseSignal))) {
  $taskLeaf = Split-Path -Leaf $taskArtifact
  if ($taskLeaf -eq 'ui-preferences.json' -or $taskLeaf.StartsWith('.mscanvas-ui-preferences-')) {
    throw 'A hold artifact may not be named like a preference record or its private sibling.'
  }
}
if (-not (Test-Path -LiteralPath $root -PathType Container)) { throw 'The task-owned preference root does not exist.' }
$target = Join-Path $root 'ui-preferences.json'
if (-not (Test-Path -LiteralPath $target -PathType Leaf)) {
  throw 'The published preference record must already exist; this helper never creates one.'
}
# No reparse traversal, from the held file all the way to the drive root.
# The containment check above compares strings, and a junction anywhere
# above the evidence area -- at .tmp, or at the repository itself -- would
# make that comparison say "inside" about somewhere else entirely.
$node = Get-Item -LiteralPath $target -Force
while ($null -ne $node) {
  if (($node.Attributes -band [IO.FileAttributes]::ReparsePoint) -ne 0) { throw 'No reparse traversal in the preference hold.' }
  $node = if ($node -is [IO.DirectoryInfo]) { $node.Parent } else { $node.Directory }
}

Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
using Microsoft.Win32.SafeHandles;
public static class M75PreferenceHold {
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
  public static extern SafeFileHandle CreateFileW(string path, uint access, uint share, IntPtr security, uint creation, uint flags, IntPtr template);
  /// GENERIC_READ, share READ only, OPEN_EXISTING, and no reparse traversal.
  /// Read sharing keeps the application's own reader working; the missing
  /// delete sharing is what the publish step will really be refused for.
  public static SafeFileHandle Hold(string path, out int error) {
    var handle = CreateFileW(path, 0x80000000, 0x00000001, IntPtr.Zero, 3, 0x00200000, IntPtr.Zero);
    error = handle.IsInvalid ? Marshal.GetLastWin32Error() : 0;
    return handle;
  }
}
'@

$bytes = [IO.File]::ReadAllBytes($target)
$sha = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($bytes)).Replace('-', '').ToLowerInvariant()
$record = [ordered]@{
  kind = 'task-owned preference record hold'
  processId = $PID
  root = $root
  fileName = 'ui-preferences.json'
  sharing = 'GENERIC_READ; FILE_SHARE_READ; no write or delete sharing'
  byteLengthAtHold = $bytes.Length
  sha256AtHold = $sha
  armedUtc = [DateTime]::UtcNow.ToString('o')
  held = $false
  released = $false
  expired = $false
}
# UTF-8 with no byte order mark, explicitly: Windows PowerShell's own `UTF8`
# encoding writes one, and a mark in front of the first brace makes this
# journal unreadable to the harness that has to poll it.
$plainUtf8 = New-Object Text.UTF8Encoding($false)
function Save-Record { [IO.File]::WriteAllText($Journal, ($record | ConvertTo-Json -Depth 5), $plainUtf8) }
Save-Record

$deadline = [DateTime]::UtcNow.AddSeconds($LifetimeSeconds)
$held = $null
try {
  $win32 = 0
  $held = [M75PreferenceHold]::Hold($target, [ref] $win32)
  if ($held.IsInvalid) {
    $held.Dispose(); $held = $null
    throw "The published preference record could not be held open (Win32 $win32)."
  }
  $record.held = $true
  $record.heldUtc = [DateTime]::UtcNow.ToString('o')
  Save-Record
  while ([DateTime]::UtcNow -lt $deadline -and -not (Test-Path -LiteralPath $ReleaseSignal)) { Start-Sleep -Milliseconds 25 }
  if (-not (Test-Path -LiteralPath $ReleaseSignal)) {
    $record.expired = $true
    Save-Record
    throw 'The bounded preference hold expired before explicit release.'
  }
} finally {
  if ($null -ne $held) {
    $held.Dispose()
    $record.released = $true
    $record.releasedUtc = [DateTime]::UtcNow.ToString('o')
    # Read back: the held record must be exactly the bytes it was, because a
    # refused publish must not have changed it. Reported rather than asserted
    # here, so releasing the hold never fails on the reading.
    try {
      $after = [IO.File]::ReadAllBytes($target)
      $record.byteLengthAtRelease = $after.Length
      $record.sha256AtRelease = [BitConverter]::ToString([Security.Cryptography.SHA256]::Create().ComputeHash($after)).Replace('-', '').ToLowerInvariant()
    } catch {
      $record.readBackError = $_.Exception.Message
    }
  }
  Save-Record
}
$record | ConvertTo-Json -Depth 5 -Compress
