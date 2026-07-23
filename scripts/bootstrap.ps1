$ErrorActionPreference = "Stop"

Write-Host "Enabling pnpm 11.15.1 via Corepack..."
corepack enable
corepack prepare pnpm@11.15.1 --activate

Write-Host "Installing Rust 1.97.1 with rustfmt and clippy..."
rustup toolchain install 1.97.1 --profile minimal --component rustfmt,clippy

Write-Host "Installing JavaScript dependencies..."
pnpm install

Write-Host "Generating Cargo lockfile..."
cargo +1.97.1 generate-lockfile

Write-Host "Running repository checks..."
pnpm typecheck
pnpm test
pnpm build
cargo +1.97.1 fmt --all --check
cargo +1.97.1 clippy --workspace --all-targets --all-features -- -D warnings
cargo +1.97.1 test --workspace --all-targets
python scripts/check_repo.py

Write-Host "Bootstrap verified. Review and commit pnpm-lock.yaml and Cargo.lock."
