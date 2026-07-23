# ADR 0002 — User-installed ProteoWizard as the first conversion backend

- Status: Accepted for M0–M3
- Date: 2026-07-22

## Context

ProteoWizard provides mature conversion and vendor-reader integration, but redistribution and platform/vendor licensing require care.

## Decision

The initial app detects and invokes a user-installed ProteoWizard. It does not bundle or automatically download proprietary readers. Backend invocation uses typed argv arrays through a Rust adapter/executor.

## Consequences

- First-run diagnostics are a primary product flow.
- CI can test command planning and open fixtures; vendor RAW integration remains controlled/local.
- Bundling or adding another backend requires a separate legal/technical decision.
