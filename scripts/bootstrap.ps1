Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

$MinimumNodeVersion = [version]"22.13.0"
$NodeMajorVersion = 22
$PnpmVersion = "11.15.1"
$RustToolchain = "1.97.1"

function Assert-NativeSuccess {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Step,
        [Parameter(Mandatory = $true)]
        [int]$ExitCode
    )

    if ($ExitCode -ne 0) {
        throw "$Step failed with exit code $ExitCode."
    }
}

$NodeVersionText = (& node --version).Trim()
Assert-NativeSuccess -Step "Read Node.js version" -ExitCode $LASTEXITCODE
$NodeVersion = [version]$NodeVersionText.TrimStart([char]"v")
if ($NodeVersion -lt $MinimumNodeVersion -or $NodeVersion.Major -ne $NodeMajorVersion) {
    throw "Node.js >=$MinimumNodeVersion <23 is required; found $NodeVersion."
}

Write-Host "Installing pinned pnpm $PnpmVersion through npm..."
npm install --global --no-audit --no-fund "pnpm@$PnpmVersion"
Assert-NativeSuccess -Step "Install pnpm $PnpmVersion" -ExitCode $LASTEXITCODE

$InstalledPnpmVersion = (& pnpm --version).Trim()
Assert-NativeSuccess -Step "Read pnpm version" -ExitCode $LASTEXITCODE
if ($InstalledPnpmVersion -ne $PnpmVersion) {
    throw "Expected pnpm $PnpmVersion; found $InstalledPnpmVersion."
}

Write-Host "Installing Rust $RustToolchain with rustfmt and clippy..."
rustup toolchain install $RustToolchain --profile minimal --component rustfmt,clippy
Assert-NativeSuccess -Step "Install Rust $RustToolchain" -ExitCode $LASTEXITCODE

Write-Host "Installing JavaScript dependencies from pnpm-lock.yaml..."
pnpm install --frozen-lockfile
Assert-NativeSuccess -Step "Install JavaScript dependencies" -ExitCode $LASTEXITCODE

Write-Host "Running repository checks..."
pnpm lint
Assert-NativeSuccess -Step "Frontend lint" -ExitCode $LASTEXITCODE
pnpm typecheck
Assert-NativeSuccess -Step "Frontend typecheck" -ExitCode $LASTEXITCODE
pnpm test
Assert-NativeSuccess -Step "Frontend tests" -ExitCode $LASTEXITCODE
pnpm build
Assert-NativeSuccess -Step "Frontend build" -ExitCode $LASTEXITCODE
cargo "+$RustToolchain" fmt --all --check
Assert-NativeSuccess -Step "Rust format" -ExitCode $LASTEXITCODE
cargo "+$RustToolchain" clippy --locked --workspace --all-targets --all-features -- -D warnings
Assert-NativeSuccess -Step "Rust Clippy" -ExitCode $LASTEXITCODE
cargo "+$RustToolchain" test --locked --workspace --all-targets
Assert-NativeSuccess -Step "Rust tests" -ExitCode $LASTEXITCODE
python -B scripts/check_repo.py
Assert-NativeSuccess -Step "Repository validation" -ExitCode $LASTEXITCODE

Write-Host "Bootstrap verified with the committed pnpm-lock.yaml and Cargo.lock."
