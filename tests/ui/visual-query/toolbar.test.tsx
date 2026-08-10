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
    render(<VisualQueryToolbar canStartOver={false} onStartOver={() => {}} />);
    expect(screen.queryByTestId(VisualQueryAccessibility.startOver)).not.toBeInTheDocument();
  });

  it("calls onStartOver when Start over is clicked", async () => {
    const user = userEvent.setup();
    const onStartOver = vi.fn();
    render(<VisualQueryToolbar canStartOver={true} onStartOver={onStartOver} />);
    await user.click(screen.getByRole("button", { name: VisualQueryCopy.startOverTitle }));
    expect(onStartOver).toHaveBeenCalledOnce();
  });

  it("does not render a Run query button", () => {
    render(<VisualQueryToolbar canStartOver={true} onStartOver={() => {}} />);
    expect(screen.queryByRole("button", { name: /run query/i })).not.toBeInTheDocument();
  });
});
