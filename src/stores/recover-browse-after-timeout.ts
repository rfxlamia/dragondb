import type { ProfileId } from "../ipc/contract";
import { unknownErrorMessage } from "../lib/unknown-error-message";
import {
  type BrowseLifecycle,
  type BrowseRetryTarget,
  browseRetryOf,
} from "./browse-session-store";
import type { AppStores } from "./compose-app-stores";

const RECONNECT_FAILED_MESSAGE = "Couldn't reconnect. Check the connection, then try again.";

let reconnectInFlight: Promise<void> | null = null;

function reconnectRequired(
  retry: BrowseRetryTarget | undefined,
  error: string | null,
  busy = false,
): BrowseLifecycle {
  return { phase: "reconnectRequired", retry, error, busy };
}

/**
 * Single owner for explicit reconnect after a stuck/failed browse cancel.
 * Uses the composed session graph (disconnect then connect); never auto-retries browse.
 */
export function recoverBrowseAfterTimeout(stores: AppStores, profileId: ProfileId): Promise<void> {
  if (reconnectInFlight !== null) return reconnectInFlight;
  reconnectInFlight = (async () => {
    const retry = browseRetryOf(stores.browse.getState().lifecycle);
    const generationAtStart = stores.browse.getState().generation;
    stores.browse.getState().publish(generationAtStart, {
      lifecycle: reconnectRequired(retry, null, true),
    });
    try {
      await stores.session.getState().disconnect();
      await stores.session.getState().connect(profileId);
      const generation = stores.browse.getState().generation;
      stores.browse.getState().publish(generation, {
        lifecycle: { phase: "retryReady", retry, error: null },
      });
    } catch (error) {
      const generation = stores.browse.getState().generation;
      stores.browse.getState().publish(generation, {
        lifecycle: reconnectRequired(retry, unknownErrorMessage(error, RECONNECT_FAILED_MESSAGE)),
      });
      throw error;
    }
  })().finally(() => {
    reconnectInFlight = null;
  });
  return reconnectInFlight;
}
