/**
 * The per-document secret Rust installs before any script runs.
 *
 * Shared by every owned operation that is authority over a native picker or
 * over a file this application writes, which is now more than one feature's
 * boundary: the conversion queue, the drop subscription and the UI preference
 * store all prove the calling document the same way. Kept in one module so
 * there is one reader of the property and one header name, rather than a copy
 * per boundary that can drift.
 *
 * Read from this JavaScript realm before any queued work, so a delayed call
 * from a replaced document keeps its old header and fails Rust's
 * current-document proof.
 */

export const DOCUMENT_AUTHORITY_HEADER = "mscanvas-document-authority";

const DOCUMENT_AUTHORITY_PROPERTY = "__MSCANVAS_DOCUMENT_AUTHORITY__";

export function currentDocumentAuthority(): string {
  const authority = Reflect.get(globalThis, DOCUMENT_AUTHORITY_PROPERTY);
  if (typeof authority !== "string" || !/^[0-9a-f]{32}$/.test(authority)) {
    throw new Error("The current page does not have owned-operation authority.");
  }
  return authority;
}

/** The headers one owned invoke carries. */
export function documentAuthorityHeaders(): { readonly headers: Record<string, string> } {
  return { headers: { [DOCUMENT_AUTHORITY_HEADER]: currentDocumentAuthority() } };
}
