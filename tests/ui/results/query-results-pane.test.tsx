/** @vitest-environment jsdom */

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { TabResultGrid, TabRunStatus } from "../../../src/stores/tabs-store";
import { QueryResultsPane } from "../../../src/ui/results/query-results-pane";
import { ResultsAccessibility } from "../../../src/ui/results/results-accessibility";
import { ResultsCopy } from "../../../src/ui/results/results-copy";

afterEach(() => {
  cleanup();
});

const cachedCompact: TabResultGrid = { columns: ["id"], rows: [["cached"]] };

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
});
