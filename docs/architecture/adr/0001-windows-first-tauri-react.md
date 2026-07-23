# ADR 0001 — Windows-first Tauri 2 + React architecture

- Status: Accepted
- Date: 2026-07-22

## Context

Vendor-reader availability and the target MSConvertGUI pain are strongest on Windows. The product needs modern interaction plus safe native filesystem/process boundaries and later CLI reuse.

## Decision

Use Tauri 2 with a Rust host/core and React + TypeScript + Vite frontend. Windows is the supported first desktop target; cross-platform work follows proven backend/packaging capability.

## Consequences

- React does not receive general shell/filesystem permissions.
- Tauri IPC remains narrow and typed.
- Rust domain/adapters are designed for reuse outside the GUI.
- Windows CI/smoke tests are release gates; web-only tests do not prove desktop readiness.
