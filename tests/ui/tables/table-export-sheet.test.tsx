/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNREADABLE_EXPORT_SENTINEL } from "../../../src/lib/result-cell";
import { TableExportSheet } from "../../../src/ui/tables/table-export-sheet";
import { TablesAccessibility } from "../../../src/ui/tables/tables-accessibility";
import { TablesCopy } from "../../../src/ui/tables/tables-copy";
import { resultFixture } from "../../lib/result-fixture";

afterEach(() => cleanup());

const table = { schema: "public", name: "orders", tableType: "regular" as const };

describe("TableExportSheet", () => {
  it("whole-table CSV+JSON export writes cell states, never state objects", async () => {
    const user = userEvent.setup();
    const saveCsvFile = vi.fn().mockResolvedValue(undefined);
    const saveTextFile = vi.fn().mockResolvedValue(undefined);
    const fixture = resultFixture({
      columns: ["id", "qty", "active", "price", "note", "secret", "big"],
      columnTypes: [
        { name: "id", typeName: "int8", typeOid: 20 },
        { name: "qty", typeName: "int4", typeOid: 23 },
        { name: "active", typeName: "bool", typeOid: 16 },
        { name: "price", typeName: "numeric", typeOid: 1700 },
        { name: "note", typeName: "text", typeOid: 25 },
        { name: "secret", typeName: "bytea", typeOid: 17 },
        { name: "big", typeName: "text", typeOid: 25 },
      ],
      rows: [
        [
          "9223372036854775807",
          42,
          true,
          "19.99",
          null,
          { state: "unreadable", typeName: "bytea" },
          { state: "truncated", text: "partial" },
        ],
      ],
    });
    const onFetchAll = vi.fn().mockResolvedValue({
      columns: fixture.columns,
      columnTypes: fixture.columnTypes,
      rows: fixture.rows,
    });

    render(
      <TableExportSheet
        open
        table={table}
        onClose={vi.fn()}
        onFetchAll={onFetchAll}
        saveCsvFile={saveCsvFile}
        saveTextFile={saveTextFile}
      />,
    );

    await user.click(screen.getByRole("button", { name: TablesCopy.exportCsv }));
    await user.click(screen.getByRole("button", { name: TablesCopy.exportJson }));

    expect(onFetchAll).toHaveBeenCalledTimes(1);
    expect(saveCsvFile).toHaveBeenCalledTimes(1);
    expect(saveTextFile).toHaveBeenCalledTimes(1);

    const csv = saveCsvFile.mock.calls[0]?.[0] as string;
    expect(csv).toContain("9223372036854775807");
    expect(csv).toContain("42");
    expect(csv).toContain("true");
    expect(csv).toContain("19.99");
    expect(csv).toContain(UNREADABLE_EXPORT_SENTINEL);
    expect(csv).toContain("partial... [truncated]");
    expect(csv).not.toContain("[object Object]");
    expect(csv).not.toMatch(/\{"state":/);
    const csvFields = csv.split("\n")[1]?.split(",") ?? [];
    expect(csvFields[4]).toBe("");

    const jsonText = saveTextFile.mock.calls[0]?.[0] as string;
    expect(jsonText).not.toContain("[object Object]");
    expect(jsonText).not.toMatch(/\{"state":/);
    const parsed = JSON.parse(jsonText) as {
      columns: string[];
      rows: unknown[][];
    };
    expect(parsed.columns).toEqual(fixture.columns);
    expect(parsed.rows[0]?.[0]).toBe("9223372036854775807");
    expect(parsed.rows[0]?.[1]).toBe(42);
    expect(parsed.rows[0]?.[2]).toBe(true);
    expect(parsed.rows[0]?.[3]).toBe("19.99");
    expect(parsed.rows[0]?.[4]).toBeNull();
    expect(parsed.rows[0]?.[5]).toBe(UNREADABLE_EXPORT_SENTINEL);
    expect(parsed.rows[0]?.[6]).toBe("partial... [truncated]");
  });

  it("does not render when closed", () => {
    render(
      <TableExportSheet
        open={false}
        table={table}
        onClose={vi.fn()}
        onFetchAll={vi.fn()}
        saveCsvFile={vi.fn()}
        saveTextFile={vi.fn()}
      />,
    );
    expect(screen.queryByTestId(TablesAccessibility.exportSheet)).toBeNull();
  });
});
