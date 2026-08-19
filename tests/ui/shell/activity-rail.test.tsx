/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ConnectionAccessibility } from "../../../src/ui/connection/connection-accessibility";
import { ConnectionCopy } from "../../../src/ui/connection/connection-copy";
import { HelpCopy } from "../../../src/ui/help/help-copy";
import { ActivityRail } from "../../../src/ui/shell/activity-rail";

afterEach(() => {
  cleanup();
});

describe("ActivityRail", () => {
  it("labels the toggle Hide sidebar while the panel is open", () => {
    render(
      <ActivityRail
        collapsed={false}
        onToggle={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(ConnectionAccessibility.collapseConnection);
    expect(toggle.getAttribute("aria-label")).toBe(ConnectionCopy.collapseConnection);
  });

  it("labels the toggle Show sidebar while the panel is collapsed", () => {
    render(
      <ActivityRail
        collapsed={true}
        onToggle={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(ConnectionAccessibility.collapseConnection);
    expect(toggle.getAttribute("aria-label")).toBe(ConnectionCopy.showConnection);
  });

  it("calls onToggle when the toggle is pressed", async () => {
    const user = userEvent.setup();
    const onToggle = vi.fn();
    render(
      <ActivityRail
        collapsed={false}
        onToggle={onToggle}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId(ConnectionAccessibility.collapseConnection));

    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("disables the toggle when toggleDisabled is set", () => {
    render(
      <ActivityRail
        collapsed={false}
        toggleDisabled={true}
        onToggle={vi.fn()}
        onOpenSettings={vi.fn()}
        onOpenHelp={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(ConnectionAccessibility.collapseConnection);
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
  });

  it("opens settings and help from the lower buttons", async () => {
    const user = userEvent.setup();
    const onOpenSettings = vi.fn();
    const onOpenHelp = vi.fn();
    render(
      <ActivityRail
        collapsed={false}
        onToggle={vi.fn()}
        onOpenSettings={onOpenSettings}
        onOpenHelp={onOpenHelp}
      />,
    );

    await user.click(screen.getByLabelText(HelpCopy.openSettings));
    await user.click(screen.getByLabelText(HelpCopy.openHelp));

    expect(onOpenSettings).toHaveBeenCalledTimes(1);
    expect(onOpenHelp).toHaveBeenCalledTimes(1);
  });
});
