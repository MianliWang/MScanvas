/**
 * The one browser focus behaviour jsdom does not reproduce.
 *
 * Disabling the focused control is what blurs it in a real browser, and the
 * browser does not put focus back when the control is enabled again — which is
 * the whole reason MSCanvas restores it by hand after an acquisition picker.
 * jsdom leaves a disabled control focused and then refuses to blur it, because
 * an unfocusable element cannot be blurred, so a test written against jsdom's
 * behaviour would pass with the restoration deleted.
 *
 * The control is briefly enabled to move the keyboard off it and set back
 * exactly as it was. React owns the attribute and is not consulted in between.
 */
export function blurAsABrowserWould(control: HTMLElement): void {
  const button = control as HTMLButtonElement;
  const disabled = button.disabled;
  button.disabled = false;
  button.blur();
  button.disabled = disabled;
}
