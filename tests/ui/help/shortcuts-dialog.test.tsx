/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpCopy } from "../../../src/ui/help/help-copy";
import { ShortcutsDialog } from "../../../src/ui/help/shortcuts-dialog";

afterEach(() => cleanup());

describe("ShortcutsDialog", () => {
  it("shows the shortcut list without Support", () => {
    render(<ShortcutsDialog open={true} onOpenChange={vi.fn()} platform="Mac" />);
    expect(screen.getByRole("dialog", { name: HelpCopy.shortcutsTitle })).toBeInTheDocument();
    expect(screen.getByText(HelpCopy.newTab)).toBeInTheDocument();
    expect(screen.getByText("⌘T")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: HelpCopy.support })).toBeNull();
  });
});
