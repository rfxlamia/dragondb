/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";
import { StatementPicker } from "../../../src/ui/visual-query/statement-picker";

afterEach(() => {
  cleanup();
});

describe("StatementPicker", () => {
  it("renders only SELECT", () => {
    render(<StatementPicker onChoose={() => {}} />);
    const items = VisualQueryCopy.statementMenuItems();
    expect(items).toHaveLength(1);
    expect(items[0]?.kind).toBe("select");
    expect(
      screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(VisualQueryAccessibility.statementMenuItem("createTable")),
    ).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.statementMenuItem("update"))).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.statementMenuItem("delete"))).toBeNull();
  });

  it("calls onChoose with select when SELECT is clicked", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<StatementPicker onChoose={onChoose} />);
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(onChoose).toHaveBeenCalledWith("select");
  });
});
