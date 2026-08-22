<#
.SYNOPSIS
  Reads the system clipboard's image from outside the application.

.DESCRIPTION
  MSCanvas puts a figure on the clipboard and has no capability to read one
  back: `capabilities/default.json` grants the webview no clipboard permission,
  and Tauri denies what a capability does not list. That posture is the point of
  the feature, so verifying it cannot be done from inside the application -- a
  test that could read the clipboard would be testing an application that had
  been given the very capability this one refuses.

  So the reading happens here, in the test process. What it reports is what any
  other program on the machine would see after the user pressed `Copy plot`.

  Writes one JSON object: whether an image is present, its dimensions, and
  whether it is more than one flat colour. Sampling rather than a full scan --
  a figure that drew nothing is uniform everywhere, and a grid of samples finds
  that as reliably as reading every pixel and far faster on a large image.

.PARAMETER Clear
  Empties the clipboard instead of reading it, so a run leaves the machine as it
  found it.
#>
[CmdletBinding()]
param([switch] $Clear)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

if ($Clear) {
  [System.Windows.Forms.Clipboard]::Clear()
  [ordered]@{ cleared = $true } | ConvertTo-Json -Compress
  exit 0
}

$result = [ordered]@{
  present  = $false
  width    = 0
  height   = 0
  distinct = 0
  detail   = ''
}

if (-not [System.Windows.Forms.Clipboard]::ContainsImage()) {
  $result.detail = 'the clipboard holds no image'
  $result | ConvertTo-Json -Compress
  exit 2
}

$image = [System.Windows.Forms.Clipboard]::GetImage()
if ($null -eq $image) {
  $result.detail = 'the clipboard reported an image it would not hand over'
  $result | ConvertTo-Json -Compress
  exit 3
}

try {
  $result.present = $true
  $result.width = $image.Width
  $result.height = $image.Height

  $bitmap = New-Object System.Drawing.Bitmap($image)
  try {
    $seen = New-Object 'System.Collections.Generic.HashSet[int]'
    # A 16 x 16 grid inset from the edges, so a figure that drew only its
    # background is one colour and one that drew axes and peaks is not.
    for ($row = 0; $row -lt 16; $row++) {
      for ($column = 0; $column -lt 16; $column++) {
        $x = [int](($column + 0.5) * $bitmap.Width / 16)
        $y = [int](($row + 0.5) * $bitmap.Height / 16)
        $x = [Math]::Min($x, $bitmap.Width - 1)
        $y = [Math]::Min($y, $bitmap.Height - 1)
        [void] $seen.Add($bitmap.GetPixel($x, $y).ToArgb())
      }
    }
    $result.distinct = $seen.Count
  }
  finally {
    $bitmap.Dispose()
  }
}
finally {
  $image.Dispose()
}

$result | ConvertTo-Json -Compress
exit 0
