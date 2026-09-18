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
    [switch]$AllowDirtyTree
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

    # The bundler embeds these, so they are build inputs, not just metadata.
    $buildInputs = @(
        "apps/desktop/src-tauri/tauri.conf.json",
        "apps/desktop/src-tauri/Cargo.toml",
        "apps/desktop/src-tauri/capabilities/default.json",
        "apps/desktop/package.json",
        "package.json",
        "Cargo.toml",
        "Cargo.lock",
        "pnpm-lock.yaml",
        "rust-toolchain.toml",
        ".node-version",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md"
    ) | ForEach-Object { Get-FileIdentity -Path $_ }

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
        featureGraph     = 'default features; no --features flag is passed, so e2e and test-support are off'
        buildInputs      = @($buildInputs)
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
