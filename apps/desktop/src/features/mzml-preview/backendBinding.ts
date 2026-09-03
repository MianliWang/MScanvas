/**
 * Which installation this session is bound to, as distinct from what it is
 * currently doing about the question.
 *
 * The conversion catalog is an answer about one executable, so it needs to know
 * which executable — and it needs that to be a *settled* fact. The visible
 * `BackendState` is not one: it says `checking` for the duration of any probe,
 * including a healthy recheck of an installation that never moved, and it says
 * `failed` when a command did not come back at all. Both are true statements
 * about activity, and neither is a statement that an installation disappeared.
 *
 * Reading them as one is the defect this type exists to make unrepresentable:
 *
 * ```text
 * backend check in progress  ≠  settled backend unavailable
 * ```
 *
 * A binding changes only when an authoritative verdict has settled, which is
 * exactly when what the installed build offers can have changed. Everything
 * that must not survive an installation change — a catalog, its outstanding
 * request, the plan read against it — is keyed on this rather than on activity.
 *
 * It deliberately says nothing about whether a conversion may start. That
 * remains `ConversionLane`'s, where `backendChanging` outranks `backendUsable`
 * so that a check refuses a conversion without claiming the backend is broken.
 */

import type { BackendAvailability } from "./contracts";

/**
 * The installation a settled verdict has bound this session to.
 *
 * Three members, and the first is not a fourth spelling of "unavailable":
 * `unresolved` is *no verdict has settled yet*, which is the state a session
 * mounts in and the state in which there is nothing to read a catalog for.
 * `unavailable` is a verdict — Rust looked and there is no usable build — and
 * it is the one that revokes.
 */
export type SettledBackendBinding =
  | { readonly status: "unresolved" }
  | {
      readonly status: "available";
      /** Which installation the verdict named. */
      readonly installationGeneration: number;
    }
  | {
      readonly status: "unavailable";
      /** Which installation the verdict named. */
      readonly installationGeneration: number;
    };

/** Before the session's first verdict settles. */
export const UNRESOLVED_BACKEND_BINDING: SettledBackendBinding = { status: "unresolved" };

/**
 * The binding a settled verdict establishes.
 *
 * Only ever called where a verdict has been accepted as current, because a
 * verdict that lost the ordering rule describes an installation this session
 * has already moved past.
 */
export function settledBackendBinding(
  availability: BackendAvailability,
): SettledBackendBinding {
  return {
    status: availability.state === "available" ? "available" : "unavailable",
    installationGeneration: availability.installationGeneration,
  };
}

/**
 * Whether two bindings are the same binding.
 *
 * A settled available verdict at the same generation is **the same binding**,
 * not a new one that happens to look alike — which is the whole content of the
 * G1 repair. Written as a value comparison so that a caller holding the
 * previous binding can keep it rather than replacing it with an equal object,
 * and so that nothing downstream can come to treat identity churn as news.
 */
export function sameBackendBinding(
  left: SettledBackendBinding,
  right: SettledBackendBinding,
): boolean {
  if (left.status !== right.status) {
    return false;
  }
  if (left.status === "unresolved" || right.status === "unresolved") {
    return true;
  }
  return left.installationGeneration === right.installationGeneration;
}

/**
 * The binding as one comparable value.
 *
 * What a consumer records to answer *have I already acted on this binding?*
 * without a second boolean saying so. A string rather than the object, because
 * the question is about the binding a lane served and not about which object
 * carried it: a remount, a re-memo or a React strict-mode double invocation
 * must not read as a new installation.
 */
export function backendBindingIdentity(binding: SettledBackendBinding): string {
  return binding.status === "unresolved"
    ? "unresolved"
    : `${binding.status}:${binding.installationGeneration}`;
}
