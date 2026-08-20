/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { AppSidebar } from "../../../src/ui/shell/app-sidebar";
import { SidebarCopy } from "../../../src/ui/shell/sidebar-copy";

afterEach(() => {
  cleanup();
});

describe("AppSidebar", () => {
  it("shows the connections block in both tabs", () => {
    const { rerender } = render(
      <AppSidebar
        tab="schema"
        onTabChange={vi.fn()}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );
    expect(screen.getByText("connections block")).toBeTruthy();

    rerender(
      <AppSidebar
        tab="queries"
        onTabChange={vi.fn()}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );
    expect(screen.getByText("connections block")).toBeTruthy();
  });

  it("keeps inactive tab panels mounted but hidden", () => {
    render(
      <AppSidebar
        tab="schema"
        onTabChange={vi.fn()}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );

    expect(screen.getByText("schema body")).toBeTruthy();
    expect(document.getElementById("sidebar-tabpanel-queries")?.hidden).toBe(true);
    expect(document.getElementById("sidebar-tabpanel-schema")?.hidden).toBe(false);
  });

  it("reports the selected tab when the other segment is chosen", async () => {
    const user = userEvent.setup();
    const onTabChange = vi.fn();
    render(
      <AppSidebar
        tab="schema"
        onTabChange={onTabChange}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );

    await user.click(screen.getByLabelText(SidebarCopy.queriesTab));

    expect(onTabChange).toHaveBeenCalledWith("queries");
  });

  it("disables both segments while switcherDisabled is set", () => {
    render(
      <AppSidebar
        tab="schema"
        onTabChange={vi.fn()}
        switcherDisabled={true}
        connections={<p>connections block</p>}
        schema={<p>schema body</p>}
        queries={<p>queries body</p>}
      />,
    );

    expect((screen.getByLabelText(SidebarCopy.schemaTab) as HTMLInputElement).disabled).toBe(true);
    expect((screen.getByLabelText(SidebarCopy.queriesTab) as HTMLInputElement).disabled).toBe(true);
  });
});
