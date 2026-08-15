/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TabBar } from "../../../src/ui/shell/tab-bar";
import { TabBarAccessibility } from "../../../src/ui/shell/tab-bar-accessibility";

afterEach(() => cleanup());

describe("TabBar", () => {
  it("hides the strip at 1 tab and still shows New Tab", () => {
    render(
      <TabBar
        tabs={[{ id: "t1", title: "Untitled", isActive: true }]}
        onNewTab={vi.fn()}
        onSwitchTab={vi.fn()}
        onCloseTab={vi.fn()}
      />,
    );
    expect(screen.queryByTestId(TabBarAccessibility.strip)).toBeNull();
    expect(screen.getByTestId(TabBarAccessibility.newTab)).toBeInTheDocument();
    expect(screen.getByTestId(TabBarAccessibility.closeTab)).toBeInTheDocument();
  });

  it("shows both titles at 2 tabs and marks the active tab", async () => {
    const user = userEvent.setup();
    const onSwitchTab = vi.fn();
    render(
      <TabBar
        tabs={[
          { id: "t1", title: "One", isActive: false },
          { id: "t2", title: "Two", isActive: true },
        ]}
        onNewTab={vi.fn()}
        onSwitchTab={onSwitchTab}
        onCloseTab={vi.fn()}
      />,
    );
    expect(screen.getByTestId(TabBarAccessibility.strip)).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "One" })).toHaveAttribute("aria-selected", "false");
    expect(screen.getByRole("tab", { name: "Two" })).toHaveAttribute("aria-selected", "true");
    await user.click(screen.getByRole("tab", { name: "One" }));
    expect(onSwitchTab).toHaveBeenCalledWith("t1");
  });
});
