/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "../../../src/ipc/contract";
import { compactCell } from "../../../src/lib/result-compactor";
import type { TabResultGrid, TabRunStatus } from "../../../src/stores/tabs-store";
import { QueryResultsPane } from "../../../src/ui/results/query-results-pane";
import { ResultsAccessibility } from "../../../src/ui/results/results-accessibility";
import { ResultsCopy } from "../../../src/ui/results/results-copy";

afterEach(() => {
  cleanup();
});

const cachedCompact: TabResultGrid = { columns: ["id"], rows: [["cached"]] };

const column = (overrides: Partial<ColumnInfo>): ColumnInfo => ({
  name: "value",
  dataType: "text",
  isNullable: false,
  defaultValue: null,
  isPrimaryKey: false,
  isUnique: false,
  isForeignKey: false,
  ...overrides,
});

function renderPane(status: TabRunStatus, compact: TabResultGrid | null) {
  return render(<QueryResultsPane status={status} compact={compact} />);
}

describe("QueryResultsPane", () => {
  it("idle with non-null compact shows empty copy and no table", () => {
    renderPane({ kind: "idle" }, cachedCompact);
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.getByText(ResultsCopy.runQueryEmpty)).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    expect(screen.queryByText("cached")).toBeNull();
  });

  it("running shows loading copy and no table", () => {
    renderPane({ kind: "running" }, cachedCompact);
    expect(screen.getByTestId(ResultsAccessibility.loading)).toHaveTextContent(
      ResultsCopy.loadingResults,
    );
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
  });

  it("ok with null/false/0/empty-string cells formats tokens without treating them as SQL null", () => {
    renderPane(
      { kind: "ok", rowCount: 4, durationMs: 1 },
      { columns: ["id"], rows: [[null], [false], [0], [""]] },
    );
    const grid = screen.getByTestId(ResultsAccessibility.grid);
    expect(grid).toBeInTheDocument();
    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "id" })).toBeInTheDocument();
    expect(screen.getByText(ResultsCopy.nullToken)).toBeInTheDocument();
    expect(screen.getByText("false")).toBeInTheDocument();
    expect(screen.getByText("0")).toBeInTheDocument();
    const cells = screen.getAllByRole("cell");
    expect(cells.some((cell) => cell.textContent === "")).toBe(true);
    expect(screen.queryByText(/OK\s*\//)).toBeNull();
    expect(grid.textContent ?? "").not.toMatch(/\d+\s*rows/i);
    expect(grid.textContent ?? "").not.toMatch(/\d+\s*ms/i);
  });

  it("ok with zero rows shows headers and No rows found", () => {
    renderPane({ kind: "ok", rowCount: 0, durationMs: 2 }, { columns: ["id"], rows: [] });
    expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "id" })).toBeInTheDocument();
    expect(screen.getByText(ResultsCopy.noRowsFound)).toBeInTheDocument();
  });

  it("error shows Query Failed and the message with no grid", () => {
    const { container } = renderPane({ kind: "error", message: "syntax near x" }, cachedCompact);
    expect(screen.getByTestId(ResultsAccessibility.error)).toBeInTheDocument();
    expect(screen.getByText(ResultsCopy.queryFailedTitle)).toBeInTheDocument();
    expect(screen.getByText("syntax near x")).toBeInTheDocument();
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    expect(container.textContent ?? "").not.toMatch(/OK\s*\//);
    expect(container.textContent ?? "").not.toMatch(/\d+\s*rows/);
    expect(container.textContent ?? "").not.toMatch(/\d+\s*ms/);
  });

  it("long cells stay single-line via nowrap / overflow-x in query-results.css", () => {
    renderPane(
      { kind: "ok", rowCount: 1, durationMs: 1 },
      { columns: ["id"], rows: [["x".repeat(200)]] },
    );
    expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument();
    const css = readFileSync(join(process.cwd(), "src/ui/results/query-results.css"), "utf8");
    expect(css).toMatch(/white-space:\s*nowrap/);
    expect(css).toMatch(/overflow-x:\s*auto/);
  });

  // Grid rhythm is horizontal-only: a boxed cell grid reads as a spreadsheet
  // export, so separators run along rows and banding carries the eye across
  // wide ones. These assertions pin that contract (they previously pinned the
  // full per-cell border this replaced).
  it("separates rows horizontally instead of boxing every cell in query-results.css", () => {
    const css = readFileSync(join(process.cwd(), "src/ui/results/query-results.css"), "utf8");
    const cellBlock = css.match(/\.query-results__table th[\s\S]*?\{[^}]*\}/);
    expect(cellBlock).not.toBeNull();
    expect(cellBlock?.[0]).not.toMatch(/border:\s*1px solid/);
    expect(css).toMatch(/\.query-results__table th\s*\{[^}]*border-bottom:\s*1px solid/);
    expect(css).toMatch(/\.query-results__table td\s*\{[^}]*border-bottom:\s*1px solid/);
    expect(css).toMatch(/tbody tr:nth-child\(even\) td\s*\{[^}]*background/);
  });

  it("keeps the pane flush inside its split panel in query-results.css", () => {
    const css = readFileSync(join(process.cwd(), "src/ui/results/query-results.css"), "utf8");
    const paneBlock = css.match(/\.query-results\s*\{[^}]*\}/);
    expect(paneBlock).not.toBeNull();
    // No card frame: the pane *is* the content plane, and its own chrome bar
    // supplies the only hairline.
    expect(paneBlock?.[0]).not.toMatch(/border:\s*1px solid/);
    expect(paneBlock?.[0]).toMatch(/background:\s*oklch\(1 0 0\)/);
    expect(css).toMatch(/\.query-results__chrome\s*\{[^}]*border-bottom:\s*1px solid/);
  });

  it("ok grid renders one cell per column even when a compact row is short", () => {
    renderPane(
      { kind: "ok", rowCount: 1, durationMs: 1 },
      { columns: ["id", "name", "email"], rows: [[1]] },
    );
    expect(screen.getAllByRole("columnheader")).toHaveLength(3);
    expect(screen.getAllByRole("cell")).toHaveLength(3);
  });

  it("filters ALP case-insensitively and sorts nulls last", async () => {
    const user = userEvent.setup();
    render(
      <QueryResultsPane
        status={{ kind: "ok", rowCount: 3, durationMs: 1 }}
        compact={{ columns: ["x"], rows: [["alpha"], ["beta"], [null]] }}
        raw={{ columns: ["x"], rows: [["alpha"], ["beta"], [null]] }}
      />,
    );
    await user.type(screen.getByRole("searchbox"), "ALP");
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("beta")).toBeNull();
    await user.clear(screen.getByRole("searchbox"));
    await user.click(screen.getByRole("columnheader", { name: "x" }));
    const cells = screen.getAllByRole("cell").map((c) => c.textContent);
    expect(cells.slice(0, 3)).toEqual(["alpha", "beta", ResultsCopy.nullToken]);
  });

  it("formats a date cell with the Settings US pattern", () => {
    render(
      <QueryResultsPane
        status={{ kind: "ok", rowCount: 1, durationMs: 1 }}
        compact={{ columns: ["created"], rows: [["2026-08-15T12:00:00Z"]] }}
        raw={{ columns: ["created"], rows: [["2026-08-15T12:00:00Z"]] }}
        dateFormat="us"
      />,
    );
    expect(screen.getByText(/8\/15\/2026/)).toBeInTheDocument();
  });

  it("Download CSV uses raw buffer through pane, not compact cells", async () => {
    const user = userEvent.setup();
    const raw = "x".repeat(3000);
    const compactDisplay = compactCell(raw);
    const onSaveCsv = vi.fn();
    render(
      <QueryResultsPane
        status={{ kind: "ok", rowCount: 1, durationMs: 1 }}
        compact={{ columns: ["body"], rows: [[compactDisplay]] }}
        raw={{ columns: ["body"], rows: [[raw]] }}
        onSaveCsv={onSaveCsv}
      />,
    );
    await user.click(screen.getAllByRole("row")[1]!);
    await user.click(screen.getByRole("button", { name: ResultsCopy.downloadCsv }));
    expect(onSaveCsv).toHaveBeenCalledTimes(1);
    const csv = onSaveCsv.mock.calls[0]![0] as string;
    expect(csv).toContain(raw);
    expect(csv).not.toContain(compactDisplay);
  });

  it("plain SELECT without sourceTable disables edit even when hatch SQL looks editable", () => {
    render(
      <QueryResultsPane
        status={{ kind: "ok", rowCount: 1, durationMs: 1 }}
        compact={{ columns: ["id"], rows: [["1"]] }}
        raw={{ columns: ["id"], rows: [["1"]] }}
        query="SELECT * FROM users"
      />,
    );
    const editBtn = screen.getByRole("button", { name: ResultsCopy.edit });
    expect(editBtn).toBeDisabled();
    expect(editBtn).toHaveAttribute("title", "Can't Edit Query Results");
    const deleteBtn = screen.getByRole("button", { name: ResultsCopy.delete });
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn).toHaveAttribute("title", "Can't Edit Query Results");
  });

  it("browse without primary keys disables edit until metadata loads", () => {
    render(
      <QueryResultsPane
        status={{ kind: "ok", rowCount: 1, durationMs: 1 }}
        compact={{ columns: ["id"], rows: [["1"]] }}
        raw={{ columns: ["id"], rows: [["1"]] }}
        query="SELECT * FROM users"
        sourceTable={{ schema: "public", name: "users" }}
        columnMetadata={[]}
      />,
    );
    const editBtn = screen.getByRole("button", { name: ResultsCopy.edit });
    expect(editBtn).toBeDisabled();
    expect(editBtn).toHaveAttribute("title", "Can't Edit Query Results");
  });

  it("JOIN without leftover selectedTable disables edit with Swift title through pane", () => {
    render(
      <QueryResultsPane
        status={{ kind: "ok", rowCount: 1, durationMs: 1 }}
        compact={{ columns: ["id"], rows: [["1"]] }}
        raw={{ columns: ["id"], rows: [["1"]] }}
        query="SELECT * FROM a JOIN b ON a.id = b.id"
      />,
    );
    const editBtn = screen.getByRole("button", { name: ResultsCopy.edit });
    expect(editBtn).toBeDisabled();
    expect(editBtn).toHaveAttribute("title", "Can't Edit Joined Results");
    const deleteBtn = screen.getByRole("button", { name: ResultsCopy.delete });
    expect(deleteBtn).toBeDisabled();
    expect(deleteBtn).toHaveAttribute("title", "Can't Edit Joined Results");
  });

  it("leftover selectedTable after JOIN hatch stays editable (Swift short-circuit)", async () => {
    const user = userEvent.setup();
    render(
      <QueryResultsPane
        status={{ kind: "ok", rowCount: 1, durationMs: 1 }}
        compact={{ columns: ["id"], rows: [["1"]] }}
        raw={{ columns: ["id"], rows: [["1"]] }}
        query="SELECT * FROM a JOIN b ON a.id = b.id"
        sourceTable={{ schema: "public", name: "orders" }}
        columnMetadata={[column({ name: "id", isPrimaryKey: true })]}
      />,
    );
    await user.click(screen.getAllByRole("row")[1]!);
    const editBtn = screen.getByRole("button", { name: ResultsCopy.edit });
    expect(editBtn).not.toBeDisabled();
    const deleteBtn = screen.getByRole("button", { name: ResultsCopy.delete });
    expect(deleteBtn).not.toBeDisabled();
  });

  it("passes complete ColumnInfo metadata into the editor", async () => {
    const user = userEvent.setup();
    const columns = [
      column({ name: "id", dataType: "bigint", isPrimaryKey: true }),
      column({ name: "occurred_on", dataType: "date", isNullable: true }),
    ];
    render(
      <QueryResultsPane
        status={{ kind: "ok", rowCount: 1, durationMs: 1 }}
        compact={{ columns: ["id", "occurred_on"], rows: [[42, "2026-08-18"]] }}
        raw={{ columns: ["id", "occurred_on"], rows: [[42, "2026-08-18"]] }}
        sourceTable={{ schema: "public", name: "events" }}
        columnMetadata={columns}
      />,
    );
    await user.click(screen.getAllByRole("row")[1]!);
    await user.click(screen.getByRole("button", { name: ResultsCopy.edit }));
    expect(screen.getByLabelText("id")).toBeDisabled();
    expect(screen.getByLabelText("occurred_on")).toHaveAttribute("type", "date");
  });

  it("Space opens JSON viewer when a row is selected", async () => {
    const user = userEvent.setup();
    render(
      <QueryResultsPane
        status={{ kind: "ok", rowCount: 1, durationMs: 1 }}
        compact={{ columns: ["id"], rows: [["1"]] }}
        raw={{ columns: ["id"], rows: [["1"]] }}
      />,
    );
    await user.click(screen.getAllByRole("row")[1]!);
    await user.keyboard(" ");
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });
});
