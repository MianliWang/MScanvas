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

    # One field of the retained manifest, or $null where it is absent: under
    # strict mode a missing property is an error, and a refusal should say
    # which field is missing rather than fail on reading it.
    function Get-RetainedField {
        param($Record, [string[]]$Path)
        foreach ($name in $Path) {
            if ($null -eq $Record -or $Record -isnot [pscustomobject] -or
                -not ($Record.PSObject.Properties.Name -contains $name)) { return $null }
            $Record = $Record.$name
        }
        $Record
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
        # The manifest retained from that build is what links them, so it is
        # required: HEAD and whatever is left in target/release are not
        # evidence that one was built from the other. Nothing is written, and
        # the retained file is left as it is, on any refusal.
        $manifestPathExisting = Join-Path $EvidenceRoot "candidate-manifest.json"
        if (-not (Test-Path -LiteralPath $manifestPathExisting -PathType Leaf)) {
            throw ("ManifestOnly needs the retained candidate manifest at $manifestPathExisting, and there is none. " +
                "Without it nothing ties the artifacts on disk to this source; rebuild instead.")
        }
        try {
            $previous = Get-Content -LiteralPath $manifestPathExisting -Raw | ConvertFrom-Json
        }
        catch {
            throw "The retained candidate manifest at $manifestPathExisting cannot be read: $($_.Exception.Message)"
        }
        foreach ($field in "head", "tree") {
            if ((Get-RetainedField $previous $field) -notmatch '^[0-9a-f]{40}$') {
                throw "The retained candidate manifest does not record a valid $field; it cannot establish what the artifacts were built from."
            }
        }
        if ($previous.head -ne $head) {
            throw ("The retained manifest was built at $($previous.head) but HEAD is now $head. " +
                "Re-deriving would attribute an installer to source it was not built from; rebuild instead.")
        }
        if ($previous.tree -ne $tree) {
            throw "The retained manifest was built from tree $($previous.tree) but HEAD's tree is $tree; rebuild instead."
        }
        $retainedArtifacts = [ordered]@{}
        foreach ($field in "installer", "executable") {
            $digest = Get-RetainedField $previous @($field, "sha256")
            if ($digest -notmatch '^[0-9a-f]{64}$') {
                throw "The retained candidate manifest does not record the $field's SHA-256; it cannot establish which artifacts it describes."
            }
            $retainedArtifacts[$field] = $digest
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

    # The compiled frontend is the largest thing the installer carries, and
    # `beforeBuildCommand` regenerates it on every build, so it is read only now
    # -- after the build succeeded -- and never from what was on disk before it.
    # This is the build's output directory, hashed; it is not extracted from the
    # installer. Missing or empty output is refused rather than recorded as none.
    $frontendDirectory = "apps/desktop/dist"
    if (-not (Test-Path -LiteralPath $frontendDirectory -PathType Container)) {
        throw "No compiled frontend under $frontendDirectory`: the directory does not exist."
    }
    $frontendInputs = @(Get-ChildItem -LiteralPath $frontendDirectory -Recurse -File |
        ForEach-Object { Get-FileIdentity -Path $_.FullName })
    if ($frontendInputs.Count -eq 0) {
        throw "No compiled frontend under $frontendDirectory`: the directory holds no file."
    }
    $frontendMeasured = if ($ManifestOnly) {
        "re-measured from $frontendDirectory at re-derivation; not established as the frontend the installer embeds"
    } else {
        "measured from $frontendDirectory after the build succeeded; the build's output, not extracted from the installer"
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
    $executable = Get-FileIdentity -Path "target/release/mscanvas-desktop.exe"
    if ($ManifestOnly) {
        # The artifacts must be the ones the retained manifest recorded, byte for
        # byte; anything else left in target/release is not this candidate.
        foreach ($pair in @(@("installer", $installers[0]), @("executable", $executable))) {
            if ($pair[1].sha256 -ne $retainedArtifacts[$pair[0]]) {
                throw ("The $($pair[0]) on disk ($($pair[1].path), SHA-256 $($pair[1].sha256)) does not match the retained " +
                    "manifest ($($retainedArtifacts[$pair[0]])); rebuild instead.")
            }
        }
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
        frontendMeasured = $frontendMeasured
        iconInputs       = @($iconInputs)
        executable       = $executable
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
