# Builds one release candidate and records what went into it.
#
# The point of this script is not convenience -- `pnpm tauri build` is one line.
# It is that a candidate nobody can re-derive is not a candidate. Every field in
# the manifest is read from the tree being built, at the moment it is built.
#
#   pwsh -NoProfile -File ./scripts/build_candidate.ps1 -EvidenceRoot .tmp/m76-evidence
#
# Refuses a dirty tree: an installer built from bytes that are not in a commit
# cannot be mapped back to published source, which is the whole obligation.
[CmdletBinding()]
param(
    [string]$EvidenceRoot = ".tmp/m76-evidence",
    # Only for deliberately re-measuring an unchanged tree. A rebuilt installer
    # is a new candidate regardless, because the bundler stamps it.
    [switch]$AllowDirtyTree,
    # Re-derive the manifest for artifacts already on disk. For when the
    # manifest's own content was wrong: rebuilding to fix bookkeeping would
    # discard a candidate for no reason and produce a different installer.
    [switch]$ManifestOnly
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$RepositoryRoot = Split-Path -Parent $PSScriptRoot
Push-Location $RepositoryRoot
try {
    function Assert-NativeSuccess {
        param([string]$Step, [int]$ExitCode)
        if ($ExitCode -ne 0) { throw "$Step failed with exit code $ExitCode." }
    }

    function Get-FileIdentity {
        param([string]$Path)
        $item = Get-Item -LiteralPath $Path
        [ordered]@{
            path   = [IO.Path]::GetRelativePath($RepositoryRoot, $item.FullName).Replace('\', '/')
            bytes  = $item.Length
            sha256 = (Get-FileHash -LiteralPath $item.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        }
    }

    $status = (& git status --porcelain=v1 --untracked-files=all) -join "`n"
    Assert-NativeSuccess -Step "Read working tree status" -ExitCode $LASTEXITCODE
    if ($status -and -not $AllowDirtyTree) {
        throw "Working tree is not clean; a candidate must be built from committed bytes.`n$status"
    }

    $head = (& git rev-parse HEAD).Trim()
    Assert-NativeSuccess -Step "Read HEAD" -ExitCode $LASTEXITCODE
    $tree = (& git rev-parse "HEAD^{tree}").Trim()
    Assert-NativeSuccess -Step "Read HEAD tree" -ExitCode $LASTEXITCODE

    $configuration = Get-Content -LiteralPath "apps/desktop/src-tauri/tauri.conf.json" -Raw | ConvertFrom-Json

    # Configuration, lockfiles and toolchain pins: change any and the output
    # changes.
    $configuredInputs = @(
        "apps/desktop/src-tauri/tauri.conf.json",
        "apps/desktop/src-tauri/Cargo.toml",
        "apps/desktop/src-tauri/capabilities/default.json",
        "apps/desktop/package.json",
        "package.json",
        "Cargo.toml",
        "Cargo.lock",
        "pnpm-lock.yaml",
        "rust-toolchain.toml",
        ".node-version"
    )

    # Files the bundler puts *into* the package. Derived from the configuration
    # rather than listed by hand, so a resource added later cannot silently stay
    # out of the manifest.
    $bundleRoot = "apps/desktop/src-tauri"
    $shippedResources = @()
    if ($configuration.bundle.PSObject.Properties.Name -contains "licenseFile") {
        $shippedResources += (Join-Path $bundleRoot $configuration.bundle.licenseFile)
    }
    if ($configuration.bundle.PSObject.Properties.Name -contains "resources") {
        $shippedResources += @($configuration.bundle.resources.PSObject.Properties |
            ForEach-Object { Join-Path $bundleRoot $_.Name })
    }
    $shippedResources = @($shippedResources | ForEach-Object { (Resolve-Path -LiteralPath $_).Path } | Sort-Object -Unique)

    $buildInputs = @($configuredInputs | ForEach-Object { Get-FileIdentity -Path $_ }) +
        @($shippedResources | ForEach-Object { Get-FileIdentity -Path $_ })

    # The compiled frontend is the largest thing the installer carries and
    # `beforeBuildCommand` regenerates it every build, so without it the
    # manifest cannot answer which frontend this installer was built from.
    $frontendInputs = @(Get-ChildItem -LiteralPath "apps/desktop/dist" -Recurse -File -ErrorAction SilentlyContinue |
        ForEach-Object { Get-FileIdentity -Path $_.FullName })

    $iconInputs = Get-ChildItem -LiteralPath "apps/desktop/src-tauri/icons" -File |
        ForEach-Object { Get-FileIdentity -Path $_.FullName }

    $toolchain = [ordered]@{
        node   = (& node --version).Trim()
        pnpm   = (& pnpm --version).Trim()
        cargo  = (& cargo --version).Trim()
        rustc  = (& rustc --version).Trim()
        tauri  = (& pnpm --silent tauri --version).Trim()
    }

    # `MSCANVAS_*` would reach the build; record that none of them are set
    # rather than assuming a clean shell.
    $taskEnvironment = Get-ChildItem Env: |
        Where-Object { $_.Name -like "MSCANVAS_*" -or $_.Name -like "TAURI_*" } |
        ForEach-Object { "$($_.Name)=$($_.Value)" }

    # One shared workspace target directory at the repository root, so the
    # bundle lands here rather than under src-tauri.
    $bundleDirectory = "target/release/bundle"
    if ($ManifestOnly) {
        # Every identity field below is read now, while the installer was built
        # earlier. Refuse when they cannot belong together, so a re-derivation
        # cannot confidently attribute yesterday's installer to today's HEAD.
        $manifestPathExisting = Join-Path $EvidenceRoot "candidate-manifest.json"
        if (Test-Path -LiteralPath $manifestPathExisting) {
            $previous = Get-Content -LiteralPath $manifestPathExisting -Raw | ConvertFrom-Json
            if ($previous.head -ne $head) {
                throw ("The retained manifest was built at $($previous.head) but HEAD is now $head. " +
                    "Re-deriving would attribute an installer to source it was not built from; rebuild instead.")
            }
        }
        $command = "(manifest re-derived; not rebuilt)"
        $buildExit = 0
        $startedUtc = $null
        $finishedUtc = [DateTime]::UtcNow.ToString("o")
        Write-Host "Re-deriving the manifest for the artifacts already on disk ..."
    }
    else {
        if (Test-Path -LiteralPath $bundleDirectory) {
            Remove-Item -LiteralPath $bundleDirectory -Recurse -Force
        }

        $command = "pnpm tauri build"
        $startedUtc = [DateTime]::UtcNow.ToString("o")
        Write-Host "Building release candidate at $head ..."
        & pnpm tauri build
        $buildExit = $LASTEXITCODE
        $finishedUtc = [DateTime]::UtcNow.ToString("o")
        Assert-NativeSuccess -Step $command -ExitCode $buildExit
    }

    # Cargo's own record of what this binary was built with, rather than a
    # sentence about what we believe was passed. The earlier hand-written claim
    # ("no --features flag is passed") was wrong: `tauri build` does enable
    # `custom-protocol` on the tauri dependency, and that flag is exactly what
    # selects the production CSP over the development one.
    $fingerprint = Get-ChildItem -LiteralPath "target/release/.fingerprint" -Directory -Filter "mscanvas-desktop-*" -ErrorAction SilentlyContinue |
        ForEach-Object { Join-Path $_.FullName "bin-mscanvas-desktop.json" } |
        Where-Object { Test-Path -LiteralPath $_ } |
        Sort-Object { (Get-Item -LiteralPath $_).LastWriteTimeUtc } -Descending |
        Select-Object -First 1
    $featureGraph = if ($fingerprint) {
        $record = Get-Content -LiteralPath $fingerprint -Raw | ConvertFrom-Json
        [ordered]@{
            source           = [IO.Path]::GetRelativePath($RepositoryRoot, $fingerprint) -replace '\\', '/'
            enabledFeatures  = $record.features
            declaredFeatures = $record.declared_features
            note             = "measured from cargo's fingerprint for the built binary; an empty enabled set is what shows e2e is off"
        }
    } else {
        [ordered]@{ note = "no cargo fingerprint found for the built binary; feature graph NOT established" }
    }

    # `@()` matters: a single Get-FileIdentity result is an OrderedDictionary,
    # whose `.Count` is its key count, not one.
    $installers = @(Get-ChildItem -LiteralPath "$bundleDirectory/nsis" -Filter *-setup.exe -File |
        ForEach-Object { Get-FileIdentity -Path $_.FullName })
    if ($installers.Count -ne 1) {
        throw "Expected exactly one NSIS installer; found $($installers.Count)."
    }

    # The bundler fetches these and checks them against its own pinned hashes.
    # Recorded because they are shipped or run, not merely consulted.
    $bundlerCache = Join-Path $env:LOCALAPPDATA "tauri"
    $webview2Setup = Join-Path $bundlerCache "MicrosoftEdgeWebview2Setup.exe"
    $tooling = [ordered]@{
        cacheDirectory = $bundlerCache
        webview2Bootstrapper = if (Test-Path -LiteralPath $webview2Setup) {
            $identity = [ordered]@{
                bytes       = (Get-Item -LiteralPath $webview2Setup).Length
                sha256      = (Get-FileHash -LiteralPath $webview2Setup -Algorithm SHA256).Hash.ToLowerInvariant()
                fileVersion = (Get-Item -LiteralPath $webview2Setup).VersionInfo.FileVersion
                company     = (Get-Item -LiteralPath $webview2Setup).VersionInfo.CompanyName
            }
            $signature = Get-AuthenticodeSignature -LiteralPath $webview2Setup
            $identity.authenticodeStatus = $signature.Status.ToString()
            $identity.signer = $signature.SignerCertificate.Subject
            $identity
        } else { $null }
        nsisMakensis = $(
            $makensis = Join-Path $bundlerCache "NSIS/makensis.exe"
            if (Test-Path -LiteralPath $makensis) {
                [ordered]@{
                    bytes  = (Get-Item -LiteralPath $makensis).Length
                    sha256 = (Get-FileHash -LiteralPath $makensis -Algorithm SHA256).Hash.ToLowerInvariant()
                }
            } else { $null }
        )
    }

    $manifest = [ordered]@{
        utc              = $finishedUtc
        head             = $head
        tree             = $tree
        workingTreeClean = -not [bool]$status
        command          = $command
        exitCode         = $buildExit
        startedUtc       = $startedUtc
        toolchain        = $toolchain
        taskEnvironment  = @($taskEnvironment)
        featureGraph     = $featureGraph
        buildInputs      = @($buildInputs)
        shippedResources = @($shippedResources | ForEach-Object { [IO.Path]::GetRelativePath($RepositoryRoot, $_) -replace '\\', '/' })
        frontendInputs   = @($frontendInputs)
        iconInputs       = @($iconInputs)
        executable       = Get-FileIdentity -Path "target/release/mscanvas-desktop.exe"
        installer        = $installers[0]
        tooling          = $tooling
        signed           = $false
    }

    $null = New-Item -ItemType Directory -Force -Path $EvidenceRoot
    $manifestPath = Join-Path $EvidenceRoot "candidate-manifest.json"
    $manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding utf8NoBOM
    Write-Host "Candidate manifest: $manifestPath"
    $manifest | ConvertTo-Json -Depth 6
}
finally {
    Pop-Location
}
