import { Channel, invoke } from "@tauri-apps/api/core";
import { createContext, useContext } from "react";

import type { WorkspaceDropUpdate } from "./contracts";

export type UnsubscribeWorkspaceDrop = () => void;

interface WorkspaceDropSubscriptionReservation {
  readonly reservationId: string;
}

const DROP_DOCUMENT_AUTHORITY_HEADER = "mscanvas-document-authority";
const DROP_DOCUMENT_AUTHORITY_PROPERTY = "__MSCANVAS_DOCUMENT_AUTHORITY__";

function currentDropDocumentAuthority(): string {
  const authority = Reflect.get(globalThis, DROP_DOCUMENT_AUTHORITY_PROPERTY);
  if (typeof authority !== "string" || !/^[0-9a-f]{32}$/.test(authority)) {
    throw new Error("The current page does not have native drop authority.");
  }
  return authority;
}

/**
 * The one push boundary the webview needs for native Explorer drag-and-drop.
 *
 * It accepts no event name, path or shell value. Tests replace this exact seam
 * with an in-memory publisher, so rendered UI exercises the same subscription
 * lifetime without depending on a WebView.
 */
export interface WorkspaceDropTransport {
  subscribe(onUpdate: (update: WorkspaceDropUpdate) => void): Promise<UnsubscribeWorkspaceDrop>;
}

// React StrictMode deliberately sets an effect up, tears it down and sets it
// up again. Keep registration invokes in that same order: if two replacement
// commands were allowed to race, a delayed first command could become Rust's
// final subscriber after the live second command had already returned.
let registrationTail: Promise<void> = Promise.resolve();

export const tauriWorkspaceDropTransport: WorkspaceDropTransport = {
  subscribe: async (onUpdate) => {
    let active = true;
    let silenceChannel = () => undefined;
    // Capture from this JavaScript realm before any queued registration work.
    // A delayed callback from a replaced document therefore keeps its old
    // authority header and fails Rust's current-document proof.
    const documentAuthority = currentDropDocumentAuthority();
    const invokeOptions = {
      headers: { [DROP_DOCUMENT_AUTHORITY_HEADER]: documentAuthority },
    };
    const registration = registrationTail.then(async () => {
      const reservation = await invoke<WorkspaceDropSubscriptionReservation | null>(
        "subscribe_workspace_drop_updates",
        { request: { phase: "begin" } },
        invokeOptions,
      );
      if (reservation === null) {
        throw new Error("The drop subscription did not return a reservation.");
      }

      const claimedChannel = new Channel<WorkspaceDropUpdate>();
      claimedChannel.onmessage = (update) => {
        if (active) {
          onUpdate(update);
        }
      };
      silenceChannel = () => {
        claimedChannel.onmessage = () => undefined;
      };
      await invoke<null>(
        "subscribe_workspace_drop_updates",
        {
          request: {
            phase: "claim",
            reservationId: reservation.reservationId,
            channel: claimedChannel,
          },
        },
        invokeOptions,
      );
    });
    registrationTail = registration.catch(() => undefined);
    try {
      await registration;
    } catch (cause: unknown) {
      active = false;
      silenceChannel();
      throw cause;
    }

    return () => {
      active = false;
      // Channel has no public unregister method. Rust owns subscriber
      // replacement and page-load cleanup; this local barrier guarantees that
      // a late message can no longer reach React after this subscription dies.
      silenceChannel();
    };
  },
};

const WorkspaceDropTransportContext = createContext<WorkspaceDropTransport>(
  tauriWorkspaceDropTransport,
);

export const WorkspaceDropTransportProvider = WorkspaceDropTransportContext.Provider;

export function useWorkspaceDropTransport(): WorkspaceDropTransport {
  return useContext(WorkspaceDropTransportContext);
}
