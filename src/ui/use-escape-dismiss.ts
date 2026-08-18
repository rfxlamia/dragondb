import { useEffect, useRef } from "react";

/**
 * Escape-to-dismiss for stacked surfaces.
 *
 * A plain `window` keydown listener per dialog breaks the moment two of them
 * are open: every listener fires, so one Escape closes the confirm *and* the
 * sheet underneath it, leaving the pending action armed on a surface the user
 * can no longer see. Registration order also can't be reasoned about locally —
 * the connection sheet renders before the database picker in the tree, but the
 * picker's delete confirm mounts later in time.
 *
 * So dismissal is a LIFO stack: one shared listener, and Escape goes to the
 * most recently mounted surface only. That is the one on top, whichever
 * component owns its state.
 */
const dismissStack: Array<() => void> = [];

function onWindowKeyDown(event: KeyboardEvent): void {
  if (event.key !== "Escape") return;
  const topmost = dismissStack[dismissStack.length - 1];
  if (topmost === undefined) return;
  topmost();
}

export function useEscapeDismiss(onDismiss: () => void, enabled = true): void {
  // Latest-value ref: re-rendering with a new closure must not re-order the
  // stack, or a parent's render would promote it above its own child dialog.
  const latest = useRef(onDismiss);
  useEffect(() => {
    latest.current = onDismiss;
  });

  useEffect(() => {
    if (!enabled) return;
    const entry = (): void => latest.current();
    dismissStack.push(entry);
    if (dismissStack.length === 1) window.addEventListener("keydown", onWindowKeyDown);
    return () => {
      const index = dismissStack.lastIndexOf(entry);
      if (index !== -1) dismissStack.splice(index, 1);
      if (dismissStack.length === 0) window.removeEventListener("keydown", onWindowKeyDown);
    };
  }, [enabled]);
}
