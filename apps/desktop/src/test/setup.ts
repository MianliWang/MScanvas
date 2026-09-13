import "@testing-library/jest-dom/vitest";

import { cleanup, configure } from "@testing-library/react";
import { afterEach } from "vitest";

// Consumer tests use a wide desktop composition unless a case supplies another
// viewport. This selects panels only; jsdom still provides no layout evidence.
Object.defineProperties(window, {
  innerWidth: { configurable: true, writable: true, value: 1920 },
  innerHeight: { configurable: true, writable: true, value: 1080 },
});

// jsdom has no layout engine. These are import/lifecycle surfaces only; actual
// geometry, sensors, scrolling and animation are verified in browser/native QA.
if (typeof globalThis.ResizeObserver === "undefined") {
  globalThis.ResizeObserver = class implements ResizeObserver {
    observe() { /* No rendered geometry in jsdom. */ }
    unobserve() { /* No rendered geometry in jsdom. */ }
    disconnect() { /* No rendered geometry in jsdom. */ }
  };
}
if (typeof window.matchMedia !== "function") {
  window.matchMedia = query => ({ matches: query.includes("min-width: 1700px"), media: query, onchange: null,
    addListener() { /* Controlled tests may replace this boundary. */ }, removeListener() {},
    addEventListener() {}, removeEventListener() {}, dispatchEvent() { return true; } });
}
if (typeof Element.prototype.getAnimations !== "function") Element.prototype.getAnimations = () => [];

// Testing Library's own async default is one second, which is a statement about
// how long a *browser* takes to settle rather than about this suite. These
// files render the whole application against a modelled boundary and vitest
// runs them in parallel, so a machine under load can spend longer than that
// inside one `findBy*` for reasons that have nothing to do with the assertion.
//
// Raised rather than worked around per call site: a timeout reached under
// contention is not a failure anyone can act on, and a per-test `waitFor`
// option would put the number in the tests that happened to flake rather than
// in the one place it is true of all of them. Vitest's own five-second test
// timeout still bounds a genuine hang.
configure({ asyncUtilTimeout: 4_000 });

// Vitest runs without injected globals here, so Testing Library's automatic
// teardown never registers itself. Without this, one test's tree stays mounted
// and the next test matches elements belonging to both.
afterEach(() => {
  cleanup();
});
