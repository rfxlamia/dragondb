/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TABLES_LOAD_FAILED } from "../../../src/stores/schema-store";
import { ConnectionAccessibility } from "../../../src/ui/connection/connection-accessibility";
import { ConnectionCopy } from "../../../src/ui/connection/connection-copy";
import { ConnectionTablesList } from "../../../src/ui/connection/connection-tables-list";
import { TablesAccessibility } from "../../../src/ui/tables/tables-accessibility";

afterEach(() => cleanup());

describe("ConnectionTablesList", () => {
  it("shows loading copy, not No tables found, while tablesLoading", () => {
    render(<ConnectionTablesList tables={[]} tablesLoading={true} tablesErrorMessage={null} />);
    expect(screen.getByTestId(ConnectionAccessibility.tablesRegion)).toHaveTextContent(
      ConnectionCopy.tablesLoading,
    );
    expect(screen.queryByText(ConnectionCopy.noTablesFound)).toBeNull();
  });

  it("lists display names and click keeps the name buttons mounted", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionTablesList
        tables={[
          { schema: "public", name: "users", tableType: "regular" },
          { schema: "other", name: "orders", tableType: "regular" },
        ]}
        tablesLoading={false}
        tablesErrorMessage={null}
      />,
    );
    expect(screen.getByRole("button", { name: "users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "other.orders" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "users" }));
    expect(screen.getByRole("button", { name: "users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "other.orders" })).toBeInTheDocument();
  });

  it("shows No tables found when the list is empty", () => {
    render(<ConnectionTablesList tables={[]} tablesLoading={false} tablesErrorMessage={null} />);
    expect(screen.getByText(ConnectionCopy.noTablesFound)).toBeInTheDocument();
  });

  it("shows fail copy and not No tables found when tables load failed", () => {
    render(
      <ConnectionTablesList
        tables={[]}
        tablesLoading={false}
        tablesErrorMessage={TABLES_LOAD_FAILED}
      />,
    );
    expect(ConnectionCopy.tablesLoadError).toBe(
      "Could not load tables. You can still type a name.",
    );
    expect(screen.getByText(ConnectionCopy.tablesLoadError)).toBeInTheDocument();
    expect(screen.queryByText(ConnectionCopy.noTablesFound)).toBeNull();
  });

  it("clears names and fail copy when rerendered empty after disconnect unmount", () => {
    const { rerender } = render(
      <ConnectionTablesList
        tables={[{ schema: "public", name: "users", tableType: "regular" }]}
        tablesLoading={false}
        tablesErrorMessage={null}
      />,
    );
    expect(screen.getByRole("button", { name: "users" })).toBeInTheDocument();
    rerender(<ConnectionTablesList tables={[]} tablesLoading={false} tablesErrorMessage={null} />);
    expect(screen.queryByRole("button", { name: "users" })).toBeNull();
  });

  it("filters by schema through the picker", async () => {
    const user = userEvent.setup();
    const onSelectSchema = vi.fn();
    render(
      <ConnectionTablesList
        tables={[{ schema: "public", name: "activity", tableType: "regular" }]}
        tablesLoading={false}
        tablesErrorMessage={null}
        schemas={["public", "audit"]}
        selectedSchema={null}
        onSelectSchema={onSelectSchema}
      />,
    );

    await user.selectOptions(screen.getByTestId(TablesAccessibility.schemaPicker), "audit");

    expect(onSelectSchema).toHaveBeenCalledWith("audit");
  });

  it("hides the picker when there is only one schema", () => {
    render(
      <ConnectionTablesList
        tables={[{ schema: "public", name: "activity", tableType: "regular" }]}
        tablesLoading={false}
        tablesErrorMessage={null}
        schemas={["public"]}
        selectedSchema={null}
        onSelectSchema={vi.fn()}
      />,
    );

    expect(screen.queryByTestId(TablesAccessibility.schemaPicker)).toBeNull();
  });

  it("renders search above the schema picker", () => {
    render(
      <ConnectionTablesList
        tables={[{ schema: "public", name: "activity", tableType: "regular" }]}
        tablesLoading={false}
        tablesErrorMessage={null}
        schemas={["public", "audit"]}
        selectedSchema={null}
        onSelectSchema={vi.fn()}
      />,
    );

    const region = screen.getByTestId(ConnectionAccessibility.tablesRegion);
    const search = screen.getByTestId(TablesAccessibility.search);
    const picker = screen.getByTestId(TablesAccessibility.schemaPicker);
    const searchRow = search.closest(".connection-tables__search");
    const pickerRow = picker.closest("label");
    expect(searchRow).not.toBeNull();
    expect(pickerRow).not.toBeNull();
    const children = Array.from(region.children);
    expect(children.indexOf(searchRow!)).toBeLessThan(children.indexOf(pickerRow!));
  });
});
