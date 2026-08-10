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
  it("renders four statement menu items", () => {
    render(<StatementPicker onChoose={() => {}} />);
    const items = VisualQueryCopy.statementMenuItems();
    expect(items).toHaveLength(4);
    for (const item of items) {
      expect(
        screen.getByTestId(VisualQueryAccessibility.statementMenuItem(item.kind)),
      ).toBeInTheDocument();
    }
    expect(screen.getByTestId(VisualQueryAccessibility.statementMenu)).toBeInTheDocument();
  });

  it("shows Coming soon badge on update and delete", () => {
    render(<StatementPicker onChoose={() => {}} />);
    const updateButton = screen.getByTestId(VisualQueryAccessibility.statementMenuItem("update"));
    const deleteButton = screen.getByTestId(VisualQueryAccessibility.statementMenuItem("delete"));
    expect(updateButton).toHaveTextContent(/coming soon/i);
    expect(deleteButton).toHaveTextContent(/coming soon/i);
  });

  it("calls onChoose with select when SELECT is clicked", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<StatementPicker onChoose={onChoose} />);
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(onChoose).toHaveBeenCalledWith("select");
  });

  it("calls onChoose with createTable when CREATE is clicked", async () => {
    const user = userEvent.setup();
    const onChoose = vi.fn();
    render(<StatementPicker onChoose={onChoose} />);
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("createTable")));
    expect(onChoose).toHaveBeenCalledWith("createTable");
  });
});
