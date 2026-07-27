import "@testing-library/jest-dom/vitest";

import { cleanup } from "@testing-library/react";
import { afterEach } from "vitest";

// Vitest runs without injected globals here, so Testing Library's automatic
// teardown never registers itself. Without this, one test's tree stays mounted
// and the next test matches elements belonging to both.
afterEach(() => {
  cleanup();
});
