/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { LoadingOverlay } from "../../../src/ui/shell/loading-overlay";

afterEach(() => cleanup());

describe("LoadingOverlay", () => {
  it("renders Swift phase copy", () => {
    const phases = [
      "Initializing…",
      "Restoring tabs…",
      "Connecting to database…",
      "Loading databases…",
      "Loading tables…",
    ] as const;
    for (const phase of phases) {
      const { unmount } = render(<LoadingOverlay phase={phase} />);
      expect(screen.getByText(phase)).toBeInTheDocument();
      unmount();
    }
  });
});
