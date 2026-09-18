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
    )

    # The development origin is deliberately NOT one of the markers above.
    # `generate_context!` embeds the whole configuration, `devUrl` and `devCsp`
    # included, so the string is in every release binary as inert data. A
    # whole-binary search for it therefore cannot distinguish "we shipped a
    # development build" from "the config was embedded", and a check that
    # always fires says nothing. The two checks that can actually fail are
    # below: a dev origin reaching the shipped frontend, or reaching the
    # production CSP that is the one applied in a release build.
    $developmentOrigin = "127.0.0.1:1420"

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
    # Name the control, so "detectability proven" has an attributable basis
    # rather than resting on an unidentified file being present on disk.
    $controlIdentity = if ($controlAvailable) {
        [ordered]@{
            path   = $ControlExecutable
            bytes  = (Get-Item -LiteralPath $ControlExecutable).Length
            sha256 = (Get-FileHash -LiteralPath $ControlExecutable -Algorithm SHA256).Hash.ToLowerInvariant()
            note   = "a QA build from an earlier milestone, at a different source revision; used only to show these five markers are findable"
        }
    } else { $null }
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
            # A marker absent from the candidate AND absent from the control
            # proves nothing about the candidate: the search itself is unproven.
            # Proven here means only "this scanner finds THIS marker when it is
            # there" -- not that the candidate carries no test capability at all.
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
                devOrigin = (Select-String -LiteralPath $_.FullName -Pattern $developmentOrigin -SimpleMatch -Quiet) -eq $true
            }
        }

    # The CSP a release build actually applies, read from the same file the
    # bundler embedded. `devCsp` is not consulted here on purpose.
    $configuration = Get-Content -LiteralPath "apps/desktop/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
    $productionCsp = $configuration.app.security.csp
    $productionCspDirectives = @($productionCsp.PSObject.Properties | ForEach-Object { "$($_.Name) $($_.Value)" })
    $developmentOriginInProductionCsp = @($productionCspDirectives | Where-Object { $_ -like "*$developmentOrigin*" })
    $developmentOriginInFrontend = @($frontendAssets | Where-Object { $_.devOrigin })

    # Both development-origin predicates are expected to find nothing, and a
    # predicate that has never fired is indistinguishable from one that cannot.
    # Run each against a synthetic input that should trip it.
    $controlDirectory = Join-Path ([IO.Path]::GetTempPath()) ("mscanvas-devorigin-control-" + [Guid]::NewGuid().ToString("n"))
    $null = New-Item -ItemType Directory -Force -Path $controlDirectory
    try {
        $seededAsset = Join-Path $controlDirectory "seeded-asset.js"
        Set-Content -LiteralPath $seededAsset -Value "fetch('http://$developmentOrigin/');" -Encoding utf8NoBOM
        $frontendPredicateFires = (Select-String -LiteralPath $seededAsset -Pattern $developmentOrigin -SimpleMatch -Quiet) -eq $true

        $seededCsp = [pscustomobject]@{ "connect-src" = "'self' http://$developmentOrigin" }
        $seededDirectives = @($seededCsp.PSObject.Properties | ForEach-Object { "$($_.Name) $($_.Value)" })
        $cspPredicateFires = @($seededDirectives | Where-Object { $_ -like "*$developmentOrigin*" }).Count -gt 0
    }
    finally {
        Remove-Item -LiteralPath $controlDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (-not $frontendPredicateFires -or -not $cspPredicateFires) {
        throw "Development-origin controls did not fire (frontend=$frontendPredicateFires, csp=$cspPredicateFires); the checks below would be meaningless."
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $Executable

    $report = [ordered]@{
        utc                  = [DateTime]::UtcNow.ToString("o")
        executable           = [IO.Path]::GetRelativePath($RepositoryRoot, (Resolve-Path $Executable)).Replace('\', '/')
        executableSha256     = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant()
        qaControlAvailable   = $controlAvailable
        qaControl            = $controlIdentity
        markers              = @($findings)
        markerScopeNote      = "Absence shows this scanner did not find these five known QA markers. It is not proof that the candidate carries no test capability, and it is not runtime acceptance."
        developmentOrigin    = [ordered]@{
            origin                = $developmentOrigin
            inShippedFrontend     = @($developmentOriginInFrontend | ForEach-Object { $_.path })
            inProductionCsp       = @($developmentOriginInProductionCsp)
            productionCsp         = @($productionCspDirectives)
            embeddedInBinaryAsConfig = "expected: generate_context! embeds devUrl and devCsp as inert data"
            controlsFired         = [ordered]@{ frontendPredicate = $frontendPredicateFires; productionCspPredicate = $cspPredicateFires }
        }
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
    Write-Host ("  {0,-20} {1}" -f "devOriginFrontend", $(if ($developmentOriginInFrontend.Count -gt 0) { "PRESENT" } else { "absent" }))
    Write-Host ("  {0,-20} {1}" -f "devOriginProdCsp", $(if ($developmentOriginInProductionCsp.Count -gt 0) { "PRESENT" } else { "absent" }))
    if ($unproven.Count -gt 0) {
        Write-Warning "$($unproven.Count) marker search(es) unproven; build the QA control to make absence meaningful."
    }
    if ($developmentOriginInFrontend.Count -gt 0) {
        throw "The shipped frontend references $developmentOrigin in: $(($developmentOriginInFrontend.path) -join ', ')."
    }
    if ($developmentOriginInProductionCsp.Count -gt 0) {
        throw "The production CSP allows $developmentOrigin : $($developmentOriginInProductionCsp -join '; ')."
    }
    if ($leaked.Count -gt 0) {
        throw "$($leaked.Count) QA-only marker(s) present in the candidate: $(($leaked.name) -join ', ')."
    }
}
finally {
    Pop-Location
}
