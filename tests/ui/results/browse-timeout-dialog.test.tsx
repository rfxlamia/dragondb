/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BrowseTimeoutDialog } from "../../../src/ui/results/browse-timeout-dialog";
import { ResultsCopy } from "../../../src/ui/results/results-copy";

afterEach(cleanup);

describe("BrowseTimeoutDialog", () => {
  it("blocks retry while cancelling and offers Reconnect with nested alert", async () => {
    const onTryAgain = vi.fn();
    const { rerender } = render(
      <BrowseTimeoutDialog
        lifecycle={{ phase: "cancelling" }}
        onTryAgain={onTryAgain}
        onReconnect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alertdialog")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ResultsCopy.tryAgain })).toBeDisabled();

    rerender(
      <BrowseTimeoutDialog
        lifecycle={{ phase: "reconnectRequired", error: "Cancellation did not finish." }}
        onTryAgain={onTryAgain}
        onReconnect={vi.fn()}
        onCancel={vi.fn()}
      />,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("Cancellation did not finish.");
    expect(screen.getByRole("button", { name: ResultsCopy.reconnect })).toBeEnabled();
  });
});
