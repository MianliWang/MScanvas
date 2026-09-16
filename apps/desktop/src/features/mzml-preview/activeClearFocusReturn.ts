/** One active-Clear focus claim, from modal closure until Add files is usable. */
export interface ActiveClearFocusReturn {
  readonly isCurrent: () => boolean;
  readonly release: () => void;
}

export function claimActiveClearFocusReturn(owner: HTMLElement | null): ActiveClearFocusReturn {
  const active = document.activeElement;
  let current = document.hasFocus() && !document.hidden && owner !== null
    && (active === document.body || (active !== null && owner.contains(active)));
  const release = () => {
    current = false;
    document.removeEventListener("focusin", destinationChanged);
    document.removeEventListener("visibilitychange", visibilityChanged);
    window.removeEventListener("blur", release);
  };
  const destinationChanged = (event: FocusEvent) => {
    if (event.target instanceof HTMLElement && event.target !== document.body && !owner?.contains(event.target)) release();
  };
  const visibilityChanged = () => { if (document.hidden) release(); };
  if (current) {
    // These listeners deliberately outlive the modal: Radix closes its focus
    // scope in a later task, and conversion settlement may arrive later still.
    document.addEventListener("focusin", destinationChanged);
    document.addEventListener("visibilitychange", visibilityChanged);
    window.addEventListener("blur", release);
  }
  return {
    isCurrent: () => {
      if (!document.hasFocus() || document.hidden) release();
      return current;
    },
    release,
  };
}
