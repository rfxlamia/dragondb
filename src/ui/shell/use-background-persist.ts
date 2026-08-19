/**
 * Background persist — Swift `scenePhase == .background` equivalent.
 *
 * On tab hide (`visibilitychange` with `document.hidden`), window close
 * (`beforeunload`), and — in the Tauri runtime — the native window's
 * `onCloseRequested`, persist every in-memory tab's query text so it survives
 * an unexpected quit. `includeCachedResults: false` keeps this best-effort
 * write from re-sending (or wiping) an existing results blob; that contract
 * lives in `tabs-store.persistTab` (T5).
 */
import { useEffect } from "react";
import type { StoreApi } from "zustand/vanilla";
import type { TabsState } from "../../stores/tabs-store";
import { isTauriRuntime } from "./workspace-accelerators";

type TauriWindowModule = typeof import("@tauri-apps/api/window");

/**
 * Resolved once, at module load, via a real dynamic `import()` — never a
 * static top-level import — so a non-Tauri run (browser preview, most unit
 * tests) never touches the Tauri window API module at all. Gated by
 * `isTauriRuntime()`, which reads `window.__TAURI_INTERNALS__`: true only in
 * a real Tauri window, or in a test that stubs that global before this
 * module is first evaluated. The awaited result — not a lazily-re-imported
 * promise inside the effect — is what lets the close-requested listener
 * attach synchronously when the effect runs.
 */
const tauriWindow: TauriWindowModule | null = isTauriRuntime()
  ? await import("@tauri-apps/api/window")
  : null;

function persistAllTabs(store: StoreApi<TabsState>): void {
  const state = store.getState();
  for (const tab of state.tabs) {
    void state.persistTab(tab, { includeCachedResults: false }).catch(() => {
      /* best-effort background persist */
    });
  }
}

export function useBackgroundPersist(store: StoreApi<TabsState>): void {
  useEffect(() => {
    function onVisibilityChange(): void {
      if (document.hidden) persistAllTabs(store);
    }
    function onBeforeUnload(): void {
      persistAllTabs(store);
    }

    document.addEventListener("visibilitychange", onVisibilityChange);
    window.addEventListener("beforeunload", onBeforeUnload);

    let unlisten: (() => void) | undefined;
    if (tauriWindow !== null) {
      void tauriWindow
        .getCurrentWindow()
        .onCloseRequested(() => {
          persistAllTabs(store);
        })
        .then((fn) => {
          unlisten = fn;
        })
        .catch(() => {
          /* best-effort close-listener registration */
        });
    }

    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange);
      window.removeEventListener("beforeunload", onBeforeUnload);
      unlisten?.();
    };
  }, [store]);
}
