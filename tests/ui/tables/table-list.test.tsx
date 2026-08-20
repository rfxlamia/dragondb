/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo, TableRef } from "../../../src/ipc/contract";
import { TableList } from "../../../src/ui/tables/table-list";
import { TablesAccessibility } from "../../../src/ui/tables/tables-accessibility";
import { TablesCopy } from "../../../src/ui/tables/tables-copy";

afterEach(() => cleanup());

const orders: TableRef = { schema: "public", name: "orders", tableType: "regular" };
const remote: TableRef = { schema: "public", name: "remote_orders", tableType: "foreign" };
const pkCol: ColumnInfo = {
  name: "id",
  dataType: "integer",
  isNullable: false,
  defaultValue: null,
  isPrimaryKey: true,
  isUnique: true,
  isForeignKey: false,
};

describe("TableList", () => {
  it("click runs Show All Rows via onBrowse, mere focus does not", async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn();
    render(
      <TableList
        tables={[orders]}
        columnsByTable={{}}
        executing={false}
        onBrowse={onBrowse}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );
    screen.getByRole("button", { name: "orders" }).focus();
    expect(onBrowse).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: "orders" }));
    expect(onBrowse).toHaveBeenCalledWith(orders);
  });

  it("expand notifies onExpand so the parent can load columns; collapse does not", async () => {
    const user = userEvent.setup();
    const onExpand = vi.fn();
    render(
      <TableList
        tables={[orders]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
        onExpand={onExpand}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.expandColumns }));
    expect(onExpand).toHaveBeenCalledOnce();
    expect(onExpand).toHaveBeenCalledWith(orders);
    await user.click(screen.getByRole("button", { name: TablesCopy.collapseColumns }));
    expect(onExpand).toHaveBeenCalledOnce();
  });

  it("expand shows PK icon; foreign table has a distinct icon", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[orders, remote]}
        columnsByTable={{ "public.orders": [pkCol] }}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.expandColumns }));
    expect(screen.getByLabelText(TablesCopy.primaryKey)).toBeInTheDocument();
    expect(screen.getByLabelText(TablesCopy.foreignTable)).toBeInTheDocument();
  });

  it("disables Truncate for foreign tables", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[remote]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    expect(screen.getByRole("menuitem", { name: TablesCopy.truncate })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: TablesCopy.drop })).toBeEnabled();
  });

  it("Drop confirm calls dropTable callback, not onRunQuery", async () => {
    const user = userEvent.setup();
    const onDrop = vi.fn();
    const onRunQuery = vi.fn();
    render(
      <TableList
        tables={[{ schema: "public", name: "temp", tableType: "regular" }]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={onDrop}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
        onRunQuery={onRunQuery}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.drop }));
    await user.click(screen.getByRole("button", { name: TablesCopy.confirmDrop }));
    expect(onDrop).toHaveBeenCalledOnce();
    expect(onRunQuery).not.toHaveBeenCalled();
  });

  it("Drop callback rejection shows the error and keeps the table", async () => {
    const user = userEvent.setup();
    const onDrop = vi.fn(async () => {
      throw { kind: "permission", message: "cannot drop temp" };
    });
    render(
      <TableList
        tables={[{ schema: "public", name: "temp", tableType: "regular" }]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={onDrop}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.drop }));
    await user.click(screen.getByRole("button", { name: TablesCopy.confirmDrop }));
    expect(await screen.findByText("cannot drop temp")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "temp" })).toBeInTheDocument();
  });

  it("context menu actions are disabled while executing", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[orders]}
        columnsByTable={{}}
        executing={true}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    expect(screen.getByRole("menuitem", { name: TablesCopy.drop })).toBeDisabled();
    expect(screen.getByRole("menuitem", { name: TablesCopy.truncate })).toBeDisabled();
  });

  it("shows an error on the DDL sheet when generateTableDdl rejects, instead of throwing unhandled", async () => {
    const user = userEvent.setup();
    const onGenerateDdl = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <TableList
        tables={[orders]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={onGenerateDdl}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.ddl }));
    expect(await screen.findByText("boom")).toBeInTheDocument();
  });

  it("shows a generic DDL error when the rejection has no message", async () => {
    const user = userEvent.setup();
    const onGenerateDdl = vi.fn().mockRejectedValue(new Error(""));
    render(
      <TableList
        tables={[orders]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={onGenerateDdl}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.ddl }));
    expect(await screen.findByText(TablesCopy.ddlFailed)).toBeInTheDocument();
  });

  it("reports a blocking surface while a DDL error sheet is open", async () => {
    const user = userEvent.setup();
    const onBlockingChange = vi.fn();
    const onGenerateDdl = vi.fn().mockRejectedValue(new Error("boom"));
    render(
      <TableList
        tables={[orders]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={onGenerateDdl}
        onBlockingChange={onBlockingChange}
      />,
    );

    expect(onBlockingChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.ddl }));

    expect(await screen.findByText("boom")).toBeInTheDocument();
    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
  });

  it("Export menuitem is disabled when onFetchAll/saveCsvFile/saveTextFile are not all provided", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[orders]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    const exportItem = screen.getByRole("menuitem", { name: TablesCopy.export });
    expect(exportItem).toBeDisabled();
    await user.click(exportItem);
    expect(screen.queryByRole("dialog", { name: TablesCopy.exportTitle })).not.toBeInTheDocument();
  });

  it("shows 100 tables per schema then Load more reveals the next batch", async () => {
    const user = userEvent.setup();
    const onBrowse = vi.fn();
    const tables: TableRef[] = Array.from({ length: 101 }, (_, i) => ({
      schema: "public",
      name: `table_${String(i).padStart(3, "0")}`,
      tableType: "regular" as const,
    }));
    render(
      <TableList
        tables={tables}
        columnsByTable={{}}
        executing={false}
        onBrowse={onBrowse}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: "table_000" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "table_099" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "table_100" })).toBeNull();
    expect(screen.getByRole("button", { name: TablesCopy.loadMore })).toBeInTheDocument();
    screen.getByRole("button", { name: "table_000" }).focus();
    expect(onBrowse).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: TablesCopy.loadMore }));
    expect(screen.getByRole("button", { name: "table_100" })).toBeInTheDocument();
  });

  it("Export menuitem is enabled and opens the export sheet when all export callbacks are provided", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[orders]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
        onFetchAll={vi.fn().mockResolvedValue({ columns: [], rows: [] })}
        saveCsvFile={vi.fn()}
        saveTextFile={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    const exportItem = screen.getByRole("menuitem", { name: TablesCopy.export });
    expect(exportItem).toBeEnabled();
    await user.click(exportItem);
    expect(await screen.findByText(TablesCopy.exportTitle)).toBeInTheDocument();
  });

  it("filters tables by a case-insensitive substring", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[
          { schema: "public", name: "activity", tableType: "regular" },
          { schema: "public", name: "migrations", tableType: "regular" },
        ]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId(TablesAccessibility.search), "MIGRA");

    expect(screen.queryByText("activity")).toBeNull();
    expect(screen.getByText("migrations")).toBeTruthy();
  });

  it("shows a no-matches message when the filter matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[{ schema: "public", name: "activity", tableType: "regular" }]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );

    await user.type(screen.getByTestId(TablesAccessibility.search), "zzz");

    expect(screen.getByText(TablesCopy.noMatchingTables)).toBeTruthy();
  });

  it("counts matches in the schema header, not the total", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[
          { schema: "public", name: "activity", tableType: "regular" },
          { schema: "public", name: "migrations", tableType: "regular" },
        ]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );

    expect(screen.getByTestId(TablesAccessibility.schemaToggle("public")).textContent).toContain(
      "2",
    );

    await user.type(screen.getByTestId(TablesAccessibility.search), "activity");

    expect(screen.getByTestId(TablesAccessibility.schemaToggle("public")).textContent).toContain(
      "1",
    );
  });

  it("collapses a schema section and hides its rows", async () => {
    const user = userEvent.setup();
    render(
      <TableList
        tables={[{ schema: "public", name: "activity", tableType: "regular" }]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
      />,
    );

    const toggle = screen.getByTestId(TablesAccessibility.schemaToggle("public"));
    expect(toggle.getAttribute("aria-expanded")).toBe("true");

    await user.click(toggle);

    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    expect(screen.queryByText("activity")).toBeNull();
  });

  it("reports a blocking surface while the drop confirm is open", async () => {
    const user = userEvent.setup();
    const onBlockingChange = vi.fn();
    render(
      <TableList
        tables={[{ schema: "public", name: "activity", tableType: "regular" }]}
        columnsByTable={{}}
        executing={false}
        onBrowse={vi.fn()}
        onDrop={vi.fn()}
        onTruncate={vi.fn()}
        onGenerateDdl={vi.fn()}
        onBlockingChange={onBlockingChange}
      />,
    );

    expect(onBlockingChange).toHaveBeenLastCalledWith(false);

    await user.click(screen.getByRole("button", { name: TablesCopy.menu }));
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.drop }));

    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
  });
});
