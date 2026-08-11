/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";
import { VisualQueryToolbar } from "../../../src/ui/visual-query/toolbar";

afterEach(() => {
  cleanup();
});

describe("VisualQueryToolbar", () => {
  it("hides Start over when canStartOver is false", () => {
    render(
      <VisualQueryToolbar
        canStartOver={false}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={false}
        onRunQuery={() => {}}
      />,
    );
    expect(screen.queryByTestId(VisualQueryAccessibility.startOver)).not.toBeInTheDocument();
  });

  it("calls onStartOver when Start over is clicked", async () => {
    const user = userEvent.setup();
    const onStartOver = vi.fn();
    render(
      <VisualQueryToolbar
        canStartOver={true}
        onStartOver={onStartOver}
        isConnected={true}
        canRunQuery={false}
        onRunQuery={() => {}}
      />,
    );
    await user.click(screen.getByRole("button", { name: VisualQueryCopy.startOverTitle }));
    expect(onStartOver).toHaveBeenCalledOnce();
  });
});

describe("VisualQueryToolbar Run control (SP-2)", () => {
  it("disables or hides Run when disconnected", () => {
    render(
      <VisualQueryToolbar
        canStartOver={true}
        onStartOver={() => {}}
        isConnected={false}
        canRunQuery={false}
        onRunQuery={() => {}}
      />,
    );
    const run = screen.queryByTestId(VisualQueryAccessibility.runQuery);
    if (run) {
      expect(run).toBeDisabled();
    } else {
      expect(screen.queryByRole("button", { name: VisualQueryCopy.runQueryTitle })).toBeNull();
    }
  });

  it("enables Run when connected and runnable with a11y id + copy title", async () => {
    const user = userEvent.setup();
    const onRunQuery = vi.fn();
    render(
      <VisualQueryToolbar
        canStartOver={true}
        onStartOver={() => {}}
        isConnected={true}
        canRunQuery={true}
        onRunQuery={onRunQuery}
      />,
    );
    const run = screen.getByTestId(VisualQueryAccessibility.runQuery);
    expect(run).toHaveAttribute("data-testid", VisualQueryAccessibility.runQuery);
    expect(run).toHaveAccessibleName(VisualQueryCopy.runQueryTitle);
    expect(run).not.toBeDisabled();
    await user.click(run);
    expect(onRunQuery).toHaveBeenCalledOnce();
  });
});
