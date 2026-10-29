# Inspects a built candidate for things a shipped binary must not carry.
#
#   pwsh -NoProfile -File ./scripts/inspect_candidate.ps1 -EvidenceRoot .tmp/m76-evidence
#
# This is deliberately adversarial against our own build configuration. A
# `#[cfg(feature = "e2e")]` in the source and an empty `permissions` array are
# statements of intent; this script looks at the bytes of the compiled
# executable, and treats a *missing* marker as the claim to prove -- so it first
# confirms each marker is detectable at all by finding it in a QA build. A test
# that cannot fail proves nothing.
#
# It does NOT search inside the installer: NSIS compresses its payload, so a
# byte search there cannot tell absent from compressed. Installer payload
# membership is a guest read-back item, and the report says so rather than
# letting this script's silence read as coverage.
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
    # Needles are read out of the QA-only sources rather than transcribed, so a
    # rename cannot leave this searching for a string nobody emits any more.
    # A hand-written list had already drifted: it covered four of the boundary
    # script's five globals and none of the seeded-spectrum or QA-root literals,
    # so a build with `e2e` on but the boundary script omitted would have passed.
    $markers = @()
    $boundary = Get-Content -LiteralPath "apps/desktop/src-tauri/src/e2e_boundary.js" -Raw
    foreach ($global in [regex]::Matches($boundary, '__mscanvas[A-Za-z0-9]+__') | ForEach-Object { $_.Value } | Sort-Object -Unique) {
        $markers += [ordered]@{ name = "boundary:$global"; needle = $global; why = "a global the rendered-QA IPC boundary installs" }
    }
    $qaRoot = Get-Content -LiteralPath "apps/desktop/src-tauri/src/preferences/qa_root.rs" -Raw
    foreach ($literal in [regex]::Matches($qaRoot, '"(MSCANVAS_E2E_[A-Z_]+|qaRoot[A-Za-z]+)"') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique) {
        $markers += [ordered]@{ name = "qaRoot:$literal"; needle = $literal; why = "a literal only the QA preference-root path emits" }
    }
    $seed = "apps/desktop/src-tauri/src/preview/e2e_seed.rs"
    if (Test-Path -LiteralPath $seed) {
        $seedText = Get-Content -LiteralPath $seed -Raw
        # Cut at the first backslash: these are Rust source literals, so an
        # embedded `\n` is an escape in the source and not a byte in the binary.
        # Searching for the escape text finds nothing anywhere, which the
        # detectability control correctly refused to accept.
        foreach ($literal in [regex]::Matches($seedText, '(mscanvas-e2e[^"\\]*|# filterString: synthetic[^"\\]*)') | ForEach-Object { $_.Groups[1].Value } | Sort-Object -Unique) {
            $markers += [ordered]@{ name = "seed:$literal"; needle = $literal; why = "a literal only the synthetic seeded spectrum emits" }
        }
    }
    if ($markers.Count -lt 5) {
        throw "Derived only $($markers.Count) QA marker(s); the QA sources moved and this scanner would be searching for almost nothing."
    }

    # Every frontend build carries the QA preference root's three refusal codes
    # as keys of the preference-error message table, so a code the backend
    # reports can be explained. Those occurrences, and only those, are exempt
    # in the frontend scan: the key followed by that table's own value. Read
    # from the table rather than transcribed, for the same reason as the
    # needles above. If the table moves, nothing is exempt and the scan fails.
    $storageMessages = Get-Content -LiteralPath "apps/desktop/src/features/preferences/storageMessages.ts" -Raw
    $unavailableTable = [regex]::Match($storageMessages, 'const UNAVAILABLE_PROBLEMS = \{([^}]*)\}').Groups[1].Value
    $tableExemptions = [ordered]@{}
    foreach ($entry in [regex]::Matches($unavailableTable, '\b(qaRoot[A-Za-z]+): "([A-Za-z]+)"')) {
        $tableExemptions[$entry.Groups[1].Value] = $entry.Groups[2].Value
    }

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
            note   = "a QA build, used only to show the derived markers are findable; this inspection does not establish which source revision built it"
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

    # The frontend that actually ships, so "no dev server" and "no QA marker"
    # are statements about bundled assets rather than about configuration. The
    # executable embeds it compressed, so the byte search above cannot see it.
    # It is read from apps/desktop/dist only after that directory is shown to
    # be the one the candidate build recorded: anything that rebuilt it in
    # between (the release workflow once ran `pnpm e2e:build` there, without
    # the Tauri hook's environment) would otherwise be inspected in its place.
    $manifestPath = Join-Path $EvidenceRoot "candidate-manifest.json"
    if (-not (Test-Path -LiteralPath $manifestPath -PathType Leaf)) {
        throw "No candidate manifest at $manifestPath; without it nothing shows apps/desktop/dist is the frontend the candidate shipped."
    }
    $recordedFrontend = @((Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json).frontendInputs |
        ForEach-Object { "$($_.path) $($_.sha256)" } | Sort-Object)
    $frontendAssets = @(Get-ChildItem -LiteralPath "apps/desktop/dist" -Recurse -File -ErrorAction SilentlyContinue |
        ForEach-Object {
            [ordered]@{
                path     = [IO.Path]::GetRelativePath($RepositoryRoot, $_.FullName).Replace('\', '/')
                bytes    = $_.Length
                sha256   = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
                fullPath = $_.FullName
            }
        })
    $scannedFrontend = @($frontendAssets | ForEach-Object { "$($_.path) $($_.sha256)" } | Sort-Object)
    if ($recordedFrontend.Count -eq 0 -or ($recordedFrontend -join "`n") -ne ($scannedFrontend -join "`n")) {
        throw ("apps/desktop/dist is not the frontend the candidate manifest recorded, so scanning it would say " +
            "nothing about what shipped.`nRecorded:`n  $($recordedFrontend -join "`n  ")`nOn disk:`n  $($scannedFrontend -join "`n  ")")
    }

    # Each occurrence of each needle in one file, read as Latin-1 so every byte
    # is one character and an ASCII needle matches exactly the bytes on disk.
    # An occurrence is exempt only as a message-table key followed by that
    # table's own value in matching quotes.
    function Find-FrontendHit {
        param([string]$Path, [string[]]$Needles, [Collections.IDictionary]$Exempt)
        $text = [Text.Encoding]::Latin1.GetString([IO.File]::ReadAllBytes($Path))
        foreach ($needle in $Needles) {
            $context = if ($Exempt.Contains($needle)) {
                [regex]::new('\G["''`]?\s*:\s*(["''`])' + [regex]::Escape($Exempt[$needle]) + '\1')
            } else { $null }
            $at = $text.IndexOf($needle, [StringComparison]::Ordinal)
            while ($at -ge 0) {
                [ordered]@{
                    needle = $needle
                    offset = $at
                    exempt = ($null -ne $context) -and $context.IsMatch($text, $at + $needle.Length)
                }
                $at = $text.IndexOf($needle, $at + 1, [StringComparison]::Ordinal)
            }
        }
    }

    $developmentOrigins = @($developmentOrigin, "localhost:1420")
    $frontendNeedles = @($markers | ForEach-Object { $_.needle }) + $developmentOrigins
    foreach ($asset in $frontendAssets) {
        $hits = @(Find-FrontendHit -Path $asset.fullPath -Needles $frontendNeedles -Exempt $tableExemptions)
        $asset.hits = @($hits | Where-Object { -not $_.exempt })
        $asset.exempted = @($hits | Where-Object { $_.exempt })
        $asset.Remove("fullPath")
    }
    $developmentOriginInFrontend = @($frontendAssets | Where-Object { @($_.hits | Where-Object { $_.needle -in $developmentOrigins }).Count -gt 0 })
    $markersInFrontend = @($frontendAssets | ForEach-Object {
            $path = $_.path
            $_.hits | Where-Object { $_.needle -notin $developmentOrigins } | ForEach-Object { "$path : $($_.needle) at $($_.offset)" }
        })

    # The CSP a release build actually applies, read from the same file the
    # bundler embedded. `devCsp` is not consulted here on purpose.
    $configuration = Get-Content -LiteralPath "apps/desktop/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json
    $productionCsp = $configuration.app.security.csp
    $productionCspDirectives = @($productionCsp.PSObject.Properties | ForEach-Object { "$($_.Name) $($_.Value)" })
    $developmentOriginInProductionCsp = @($productionCspDirectives | Where-Object { $_ -like "*$developmentOrigin*" })

    # The frontend and CSP predicates are expected to find nothing, and a
    # predicate that has never fired is indistinguishable from one that cannot.
    # Run each against a synthetic input that should trip it: every frontend
    # needle planted bare must be flagged, and the message table's entries
    # planted in their minified form must be exempt, and nothing else.
    $controlDirectory = Join-Path ([IO.Path]::GetTempPath()) ("mscanvas-devorigin-control-" + [Guid]::NewGuid().ToString("n"))
    $null = New-Item -ItemType Directory -Force -Path $controlDirectory
    try {
        $seededAsset = Join-Path $controlDirectory "seeded-asset.js"
        $bare = ($frontendNeedles | ForEach-Object { "f('$_');" }) -join "`n"
        $table = ($tableExemptions.GetEnumerator() | ForEach-Object { "$($_.Key):``$($_.Value)``" }) -join ","
        Set-Content -LiteralPath $seededAsset -Value "$bare`nconst t={$table};" -Encoding utf8NoBOM
        $seededHits = @(Find-FrontendHit -Path $seededAsset -Needles $frontendNeedles -Exempt $tableExemptions)
        $flagged = @($seededHits | Where-Object { -not $_.exempt } | ForEach-Object { $_.needle } | Sort-Object -Unique)
        $frontendPredicateFires = ($flagged -join "`n") -eq (@($frontendNeedles | Sort-Object -Unique) -join "`n")
        $exemptionInContextOnly = @($seededHits | Where-Object { $_.exempt }).Count -eq $tableExemptions.Count

        $seededCsp = [pscustomobject]@{ "connect-src" = "'self' http://$developmentOrigin" }
        $seededDirectives = @($seededCsp.PSObject.Properties | ForEach-Object { "$($_.Name) $($_.Value)" })
        $cspPredicateFires = @($seededDirectives | Where-Object { $_ -like "*$developmentOrigin*" }).Count -gt 0
    }
    finally {
        Remove-Item -LiteralPath $controlDirectory -Recurse -Force -ErrorAction SilentlyContinue
    }
    if (-not $frontendPredicateFires -or -not $exemptionInContextOnly -or -not $cspPredicateFires) {
        throw ("Controls did not behave (frontend=$frontendPredicateFires, tableExemption=$exemptionInContextOnly, " +
            "csp=$cspPredicateFires); the checks below would be meaningless.")
    }

    $signature = Get-AuthenticodeSignature -LiteralPath $Executable

    $report = [ordered]@{
        utc                  = [DateTime]::UtcNow.ToString("o")
        executable           = [IO.Path]::GetRelativePath($RepositoryRoot, (Resolve-Path $Executable)).Replace('\', '/')
        executableSha256     = (Get-FileHash -LiteralPath $Executable -Algorithm SHA256).Hash.ToLowerInvariant()
        qaControlAvailable   = $controlAvailable
        qaControl            = $controlIdentity
        markers              = @($findings)
        markerScopeNote      = "Absence shows this scanner did not find these $($markers.Count) known QA markers in the executable or the shipped frontend. It is not proof that the candidate carries no test capability, and it is not runtime acceptance."
        developmentOrigin    = [ordered]@{
            origin                = $developmentOrigin
            inShippedFrontend     = @($developmentOriginInFrontend | ForEach-Object { $_.path })
            inProductionCsp       = @($developmentOriginInProductionCsp)
            productionCsp         = @($productionCspDirectives)
            embeddedInBinaryAsConfig = "expected: generate_context! embeds devUrl and devCsp as inert data"
            controlsFired         = [ordered]@{ frontendPredicate = $frontendPredicateFires; tableExemptionInContextOnly = $exemptionInContextOnly; productionCspPredicate = $cspPredicateFires }
        }
        bundleFiles          = @($bundleFiles)
        frontendMatchesManifest = "apps/desktop/dist matched the frontendInputs of $($manifestPath.Replace('\', '/'))"
        frontendNeedles      = @($frontendNeedles)
        frontendExemptions   = [ordered]@{
            source  = "apps/desktop/src/features/preferences/storageMessages.ts UNAVAILABLE_PROBLEMS"
            entries = $tableExemptions
            rule    = "exempt only where the key is followed by ':' and this value in matching quotes"
        }
        qaMarkersInShippedFrontend = @($markersInFrontend)
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
    Write-Host ("  {0,-20} {1}" -f "qaMarkersFrontend", $(if ($markersInFrontend.Count -gt 0) { "PRESENT" } else { "absent" }))
    Write-Host ("  {0,-20} {1}" -f "devOriginFrontend", $(if ($developmentOriginInFrontend.Count -gt 0) { "PRESENT" } else { "absent" }))
    Write-Host ("  {0,-20} {1}" -f "devOriginProdCsp", $(if ($developmentOriginInProductionCsp.Count -gt 0) { "PRESENT" } else { "absent" }))
    if ($unproven.Count -gt 0) {
        # A needle nobody can find proves nothing about the candidate, so this
        # fails rather than warns. Previously it warned and still exited 0,
        # which let the whole marker section degrade to meaningless silently.
        throw ("$($unproven.Count) marker search(es) unproven: " +
            (($unproven.name) -join ', ') +
            ". Build the QA control, or the absence below establishes nothing.")
    }
    if ($developmentOriginInFrontend.Count -gt 0) {
        throw "The shipped frontend references a development origin in: $(($developmentOriginInFrontend.path) -join ', ')."
    }
    if ($markersInFrontend.Count -gt 0) {
        throw "$($markersInFrontend.Count) QA-only marker occurrence(s) in the shipped frontend: $($markersInFrontend -join '; ')."
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
