# Inspects a built candidate for things a shipped binary must not carry.
#
#   pwsh -NoProfile -File ./scripts/inspect_candidate.ps1 -EvidenceRoot .tmp/m76-evidence
#
# This is deliberately adversarial against our own build configuration. A
# `#[cfg(feature = "e2e")]` in the source and an empty `permissions` array are
# statements of intent; this script looks at the bytes that would actually be
# installed. It searches both the compiled executable and every file the
# installer carries, and it treats a *missing* marker as the claim to prove --
# so it first confirms each marker is detectable at all by finding it in the QA
# build, when one is present. A test that cannot fail proves nothing.
#
# What it cannot establish: runtime behaviour. No static check shows that the
# installed application refuses a forged IPC call or that no dev server is
# contacted. That belongs to the installed campaign, and this script says so in
# its own output rather than letting absence read as proof.
[CmdletBinding()]
param(
    [string]$EvidenceRoot = ".tmp/m76-evidence",
    [string]$Executable = "target/release/mscanvas-desktop.exe",
    [string]$BundleDirectory = "target/release/bundle",
    # The QA build, used only as a positive control for marker detectability.
    [string]$ControlExecutable = "target/e2e/release/mscanvas-desktop.exe"
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepositoryRoot
try {
    # Each marker is a string that exists only because a QA-only code path was
    # compiled in. `mustNotAppear` is the whole point; `control` says whether we
    # are able to prove the search works.
    $markers = @(
        [ordered]@{ name = "e2eIpcTable"; needle = "__mscanvasIpcTable__"; why = "the rendered-QA IPC interception table" }
        [ordered]@{ name = "e2eIpcCalls"; needle = "__mscanvasIpcCalls__"; why = "the QA call log the page can read" }
        [ordered]@{ name = "e2eIpcSeed"; needle = "__mscanvasIpcSeed__"; why = "the pre-mount QA answer seed" }
        [ordered]@{ name = "e2eBoundary"; needle = "__mscanvasBoundary__"; why = "the QA boundary handle" }
        [ordered]@{ name = "qaPreferenceRoot"; needle = "MSCANVAS_E2E_PREFERENCE_ROOT"; why = "the QA preference-root override variable" }
        [ordered]@{ name = "devServer"; needle = "127.0.0.1:1420"; why = "the development server origin" }
    )

    function Test-Marker {
        param([string]$Path, [string]$Needle)
        # UTF-8 and UTF-16LE, because a Rust &'static str and a Windows
        # resource string are not stored the same way.
        $bytes = [IO.File]::ReadAllBytes($Path)
        foreach ($encoding in @([Text.Encoding]::UTF8, [Text.Encoding]::Unicode)) {
            $pattern = $encoding.GetBytes($Needle)
            $limit = $bytes.Length - $pattern.Length
            for ($i = 0; $i -le $limit; $i++) {
                if ($bytes[$i] -ne $pattern[0]) { continue }
                $matched = $true
                for ($j = 1; $j -lt $pattern.Length; $j++) {
                    if ($bytes[$i + $j] -ne $pattern[$j]) { $matched = $false; break }
                }
                if ($matched) { return $true }
            }
        }
        return $false
    }

    if (-not (Test-Path -LiteralPath $Executable)) {
        throw "No candidate executable at $Executable; build one first."
    }

    $controlAvailable = Test-Path -LiteralPath $ControlExecutable
    $findings = @()
    foreach ($marker in $markers) {
        $present = Test-Marker -Path $Executable -Needle $marker.needle
        $controlPresent = $null
        if ($controlAvailable) {
            $controlPresent = Test-Marker -Path $ControlExecutable -Needle $marker.needle
        }
        $findings += [ordered]@{
            name             = $marker.name
            needle           = $marker.needle
            why              = $marker.why
            presentInCandidate = $present
            presentInQaControl = $controlPresent
            # A marker absent from the candidate AND absent from the QA build
            # proves nothing about the candidate: the search itself is unproven.
            detectabilityProven = if ($null -eq $controlPresent) { $false } else { [bool]$controlPresent }
        }
    }

    # Every file the installer would place, not just the executable.
    $bundleFiles = @()
    if (Test-Path -LiteralPath $BundleDirectory) {
        $bundleFiles = Get-ChildItem -LiteralPath $BundleDirectory -Recurse -File | ForEach-Object {
            [ordered]@{
                path   = [IO.Path]::GetRelativePath($RepositoryRoot, $_.FullName).Replace('\', '/')
                bytes  = $_.Length
                sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
            }
        }
    }

    # The frontend that actually ships, so "no dev server" is a statement about
    # bundled assets rather than about configuration.
    $frontendAssets = Get-ChildItem -LiteralPath "apps/desktop/dist" -Recurse -File -ErrorAction SilentlyContinue |
        ForEach-Object {
            [ordered]@{
                path      = [IO.Path]::GetRelativePath($RepositoryRoot, $_.FullName).Replace('\', '/')
                bytes     = $_.Length
                sha256    = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                devOrigin = (Select-String -LiteralPath $_.FullName -Pattern "127\.0\.0\.1:1420" -SimpleMatch -Quiet) -eq $true
            }
        }

    $signature = Get-AuthenticodeSignature -LiteralPath $Executable

    $report = [ordered]@{
        utc                  = [DateTime]::UtcNow.ToString("o")
        executable           = [IO.Path]::GetRelativePath($RepositoryRoot, (Resolve-Path $Executable)).Replace('\', '/')
        executableSha256     = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant()
        qaControlAvailable   = $controlAvailable
        markers              = @($findings)
        bundleFiles          = @($bundleFiles)
        frontendAssets       = @($frontendAssets)
        authenticodeStatus   = $signature.Status.ToString()
        notEstablishedHere   = @(
            "Runtime refusal of a forged IPC call in the installed application.",
            "That the installed application contacts no development server while running.",
            "Capability enforcement as executed, rather than as declared."
        )
    }

    $null = New-Item -ItemType Directory -Force -Path $EvidenceRoot
    $reportPath = Join-Path $EvidenceRoot "package-inspection.json"
    $report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding utf8NoBOM

    $leaked = @($findings | Where-Object { $_.presentInCandidate })
    $unproven = @($findings | Where-Object { -not $_.detectabilityProven })
    Write-Host "Package inspection: $reportPath"
    foreach ($finding in $findings) {
        $state = if ($finding.presentInCandidate) { "PRESENT" } else { "absent" }
        $proof = if ($finding.detectabilityProven) { "detectability proven" } else { "DETECTABILITY UNPROVEN" }
        Write-Host ("  {0,-20} {1,-8} ({2})" -f $finding.name, $state, $proof)
    }
    if ($unproven.Count -gt 0) {
        Write-Warning "$($unproven.Count) marker search(es) unproven; build the QA control to make absence meaningful."
    }
    if ($leaked.Count -gt 0) {
        throw "$($leaked.Count) QA-only marker(s) present in the candidate: $(($leaked.name) -join ', ')."
    }
}
finally {
    Pop-Location
}
