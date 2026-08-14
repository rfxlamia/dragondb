import "@testing-library/jest-dom/vitest";

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
