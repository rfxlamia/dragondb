/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { HelpAccessibility } from "../../../src/ui/help/help-accessibility";
import { HelpCopy } from "../../../src/ui/help/help-copy";
import { HelpDialog } from "../../../src/ui/help/help-dialog";

afterEach(() => cleanup());

describe("HelpDialog", () => {
  it("shows DragonDB Help, Support URL, shortcut rows, and Done closes it", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<HelpDialog open={true} onOpenChange={onOpenChange} platform="Win32" />);
    expect(screen.getByRole("dialog", { name: HelpCopy.helpTitle })).toHaveTextContent(
      "DragonDB Help",
    );
    const support = screen.getByRole("link", { name: HelpCopy.support });
    expect(support).toHaveAttribute("href", "https://github.com/rfxlamia/dragondb/issues");
    expect(support.getAttribute("href")).not.toMatch(/dragon-db/);
    expect(screen.getByText(HelpCopy.newTab)).toBeInTheDocument();
    expect(screen.getByText(HelpCopy.closeTab)).toBeInTheDocument();
    expect(screen.getByText(HelpCopy.runQuery)).toBeInTheDocument();
    expect(screen.getByText("Ctrl+T")).toBeInTheDocument();
    await user.click(screen.getByTestId(HelpAccessibility.done));
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
