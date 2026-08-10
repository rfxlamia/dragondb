/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";
import { SchemaFieldPopover } from "../../../src/ui/visual-query/schema-field-popover";

afterEach(() => {
  cleanup();
});

describe("SchemaFieldPopover", () => {
  it("shows needsFrom message when items empty", () => {
    render(
      <SchemaFieldPopover
        title="Columns"
        items={[]}
        itemTitle={(s) => s}
        needsFromMessage={VisualQueryCopy.columnPopoverNeedsFromMessage}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByText(/from first/i)).toBeInTheDocument();
  });

  it("shows No matches when filter excludes all", async () => {
    const user = userEvent.setup();
    render(
      <SchemaFieldPopover
        title="Tables"
        items={["users"]}
        itemTitle={(s) => s}
        onSelect={() => {}}
      />,
    );
    await user.type(screen.getByRole("textbox"), "zzz");
    expect(screen.getByText(VisualQueryCopy.noMatchesTitle)).toBeInTheDocument();
  });

  it("calls onSelect", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(
      <SchemaFieldPopover
        title="Tables"
        items={["users"]}
        itemTitle={(s) => s}
        onSelect={onSelect}
      />,
    );
    await user.click(screen.getByRole("button", { name: "users" }));
    expect(onSelect).toHaveBeenCalledWith("users");
  });
});
