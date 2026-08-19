import "@testing-library/jest-dom/vitest";
import { vi } from "vitest";

/** jsdom has no ResizeObserver; react-resizable-panels Group mounts one. */
class ResizeObserverStub {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
}

const resizeObserver = globalThis.ResizeObserver ?? ResizeObserverStub;
globalThis.ResizeObserver = resizeObserver;
if (typeof window !== "undefined") {
  window.ResizeObserver = resizeObserver;
}

// @testing-library/react's asyncWrapper only advances fake timers when it sees
// a `jest` global (setTimeout.clock). Vitest exposes `vi` instead, so userEvent
// + vi.useFakeTimers() would hang on the wrapper's setTimeout(0).
if (typeof (globalThis as { jest?: typeof vi }).jest === "undefined") {
  (globalThis as { jest?: typeof vi }).jest = vi;
}
