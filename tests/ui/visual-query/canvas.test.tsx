/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryDocument } from "../../../src/core";
import type { DragonIpc, QueryResult } from "../../../src/ipc/contract";
import { createHistoryStore } from "../../../src/stores/history-store";
import { HistoryAccessibility } from "../../../src/ui/history/history-accessibility";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCanvas } from "../../../src/ui/visual-query/canvas";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";

afterEach(() => {
  cleanup();
});

const tables = [
  { name: "users", schema: "public" },
  { name: "events", schema: "analytics" },
];

async function openGeneratedSqlDialog(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByTestId(VisualQueryAccessibility.viewGeneratedSQL));
}

describe("VisualQueryCanvas layout chrome", () => {
  it("does not place .vq-sql-preview as a sibling under the canvas body", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    const body = container.querySelector(".vq-canvas__body");
    expect(body).not.toBeNull();
    expect(body?.querySelector(":scope > .vq-canvas__stage")).not.toBeNull();
    expect(body?.querySelector(":scope > .vq-sql-preview")).toBeNull();
    expect(container.querySelector(".vq-sql-preview")).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.generatedSQLText)).toBeNull();
  });

  it("canvas.tsx and toolbar.tsx never mention deleteHistory or clearHistory", () => {
    const canvas = readFileSync(join(process.cwd(), "src/ui/visual-query/canvas.tsx"), "utf8");
    const toolbar = readFileSync(join(process.cwd(), "src/ui/visual-query/toolbar.tsx"), "utf8");
    expect(canvas).not.toMatch(/\bdeleteHistory\b/);
    expect(canvas).not.toMatch(/\bclearHistory\b/);
    expect(toolbar).not.toMatch(/\bdeleteHistory\b/);
    expect(toolbar).not.toMatch(/\bclearHistory\b/);
  });

  it("keeps open clause menu in-flow under the trailing control", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));

    const trailing = container.querySelector(".vq-canvas__trailing");
    const menu = screen.getByTestId(VisualQueryAccessibility.clauseMenu);
    expect(trailing).not.toBeNull();
    expect(trailing?.contains(menu)).toBe(true);
  });

  it("closes clause menu on Start over so SELECT does not reopen it", async () => {
    const user = userEvent.setup();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseMenu)).toBeInTheDocument();

    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.queryByTestId(VisualQueryAccessibility.clauseMenu)).toBeNull();
  });
});

describe("visual-query.css layout contracts", () => {
  const css = readFileSync(join(process.cwd(), "src/ui/visual-query/visual-query.css"), "utf8");

  it("does not absolutely position the trailing clause menu", () => {
    const menuBlock = css.match(/\.vq-clause-menu\s*\{[^}]*\}/);
    expect(menuBlock).not.toBeNull();
    expect(menuBlock?.[0]).not.toMatch(/position:\s*absolute/);
    expect(menuBlock?.[0]).not.toMatch(/\bleft:/);
    expect(menuBlock?.[0]).not.toMatch(/\btop:/);
  });

  it("does not dock an always-on SQL preview under the canvas body", () => {
    expect(css).toMatch(/\.vq-canvas__stage\s*\{[^}]*flex:\s*1/);
    expect(css).not.toMatch(/\.vq-canvas__body[^{]*\{[^}]*\.vq-sql-preview/);
  });

  it("does not keep a .vq-canvas__status rule after the runOutcome strip was removed", () => {
    expect(css).not.toMatch(/\.vq-canvas__status/);
  });

  it("keeps chain connectors pinned to a stable top offset", () => {
    const connectorBlock = css.match(/\.vq-canvas__connector\s*\{[^}]*\}/);
    expect(connectorBlock).not.toBeNull();
    expect(connectorBlock?.[0]).not.toMatch(/align-self:\s*center/);
    expect(connectorBlock?.[0]).toMatch(/align-self:\s*flex-start/);
    expect(connectorBlock?.[0]).toMatch(/margin-top:/);
  });
});

describe("VisualQueryCanvas", () => {
  it("empty → SELECT shows clause card and re-renders preview without new doc instance", async () => {
    const user = userEvent.setup();
    const onDocumentChange = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        onDocumentChange={onDocumentChange}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    expect(onDocumentChange).toHaveBeenCalled();
    const doc = onDocumentChange.mock.calls[onDocumentChange.mock.calls.length - 1]?.[0];
    onDocumentChange.mockClear();
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    expect(onDocumentChange.mock.calls[onDocumentChange.mock.calls.length - 1]?.[0]).toBe(doc);
  });

  it("shows canRun help on the toolbar when SELECT incomplete", async () => {
    const user = userEvent.setup();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    expect(screen.getByText("Choose a table in FROM")).toBeInTheDocument();
    expect(document.querySelector(".vq-canvas__status")).toBeNull();
  });

  it("shows empty SQL preview when named projection columns are blank", async () => {
    const user = userEvent.setup();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.allColumnsToggle));
    await openGeneratedSqlDialog(user);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toHaveTextContent("—");
    expect(screen.getByText(/Choose at least one column/i)).toBeInTheDocument();
    expect(document.querySelector(".vq-sql-preview")).toBeNull();
  });

  it("notifies onCommittedFromChange on select, clear via delete FROM, and start over", async () => {
    const user = userEvent.setup();
    const onCommittedFromChange = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={true}
        onCommittedFromChange={onCommittedFromChange}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    expect(onCommittedFromChange).toHaveBeenCalledWith({ schema: "public", name: "users" });

    onCommittedFromChange.mockClear();
    await user.click(screen.getByTestId(VisualQueryAccessibility.deleteClause("from")));
    expect(onCommittedFromChange).toHaveBeenCalledWith(null);

    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    onCommittedFromChange.mockClear();
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(onCommittedFromChange).toHaveBeenCalledWith(null);
  });

  it("does not notify onCommittedFromChange when Enter confirms unchanged popover FROM", async () => {
    const user = userEvent.setup();
    const onCommittedFromChange = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={true}
        onCommittedFromChange={onCommittedFromChange}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    expect(onCommittedFromChange).toHaveBeenCalledOnce();

    onCommittedFromChange.mockClear();
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTableField));
    await user.keyboard("{Enter}");
    expect(onCommittedFromChange).not.toHaveBeenCalled();
  });

  it("does not notify onCommittedFromChange while typing FROM text but notifies on Enter commit", async () => {
    const user = userEvent.setup();
    const onCommittedFromChange = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        onCommittedFromChange={onCommittedFromChange}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    onCommittedFromChange.mockClear();
    const fromField = screen.getByTestId(VisualQueryAccessibility.fromTableField);
    await user.type(fromField, "users");
    expect(onCommittedFromChange).not.toHaveBeenCalled();
    await user.keyboard("{Enter}");
    expect(onCommittedFromChange).toHaveBeenCalledWith({ schema: null, name: "users" });
  });

  it("CREATE disables Run, does not call onRunQuery, and SQL is in the dialog", async () => {
    const user = userEvent.setup();
    const onRunQuery = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        onRunQuery={onRunQuery}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("createTable")));
    await user.type(screen.getByTestId(VisualQueryAccessibility.createTableNameField), "orders");
    await user.type(screen.getByTestId(VisualQueryAccessibility.createColumnNameField(0)), "id");
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    expect(onRunQuery).not.toHaveBeenCalled();
    expect(screen.queryByText(/only select queries can run/i)).toBeNull();
    expect(document.querySelector(".vq-canvas__status")).toBeNull();
    await openGeneratedSqlDialog(user);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText).textContent).toMatch(
      /orders/i,
    );
  });

  it("UPDATE disables Run; dialog shows em dash", async () => {
    const user = userEvent.setup();
    const onRunQuery = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        onRunQuery={onRunQuery}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("update")));
    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThanOrEqual(1);
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    expect(onRunQuery).not.toHaveBeenCalled();
    await openGeneratedSqlDialog(user);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toHaveTextContent(
      VisualQueryCopy.sqlPreviewEmpty,
    );
  });

  it("renders metadata error strip when provided", () => {
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={VisualQueryCopy.columnsLoadError}
        isConnected={true}
      />,
    );
    expect(screen.getByText(VisualQueryCopy.columnsLoadError)).toBeInTheDocument();
  });

  it("keeps supplied document instance through full edit cycle and resets to empty canvas", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    const onDocumentChange = vi.fn();
    render(
      <VisualQueryCanvas
        document={doc}
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        onDocumentChange={onDocumentChange}
      />,
    );

    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    await openGeneratedSqlDialog(user);
    const initialPreview = screen.getByTestId(
      VisualQueryAccessibility.generatedSQLText,
    ).textContent;
    await user.click(screen.getByTestId(VisualQueryAccessibility.generatedSQLDone));

    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    await openGeneratedSqlDialog(user);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText).textContent).not.toBe(
      initialPreview,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.generatedSQLDone));

    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("from"))).toBeInTheDocument();

    const fromField = screen.getByTestId(VisualQueryAccessibility.fromTableField);
    await user.type(fromField, "users");
    await user.keyboard("{Enter}");
    await openGeneratedSqlDialog(user);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText).textContent).toMatch(
      /users/i,
    );

    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    expect(onDocumentChange.mock.calls.every(([changed]) => changed === doc)).toBe(true);
  });

  it("connects WHERE field edits to live generated SQL preview", async () => {
    const user = userEvent.setup();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={true}
      />,
    );

    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("where")));

    await user.click(screen.getByTestId(VisualQueryAccessibility.whereColumnPicker));
    await user.click(screen.getByRole("button", { name: "id" }));
    await user.selectOptions(
      screen.getByTestId(VisualQueryAccessibility.whereOperatorField),
      "equals",
    );
    await user.type(screen.getByTestId(VisualQueryAccessibility.whereValueField), "42");

    await openGeneratedSqlDialog(user);
    const sql = screen.getByTestId(VisualQueryAccessibility.generatedSQLText).textContent ?? "";
    expect(sql).toMatch(/WHERE/i);
    expect(sql).toContain("42");
  });
});

describe("VisualQueryCanvas full lock + Run (SP-2)", () => {
  it("disables mutate/statement/Run while disconnected and does not show generated SQL unless dialog opened", async () => {
    const user = userEvent.setup();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={false}
        onRunQuery={undefined}
      />,
    );
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).toBeDisabled();
    const run = screen.queryByTestId(VisualQueryAccessibility.runQuery);
    if (run) expect(run).toBeDisabled();
    expect(screen.getByTestId(VisualQueryAccessibility.viewGeneratedSQL)).toBeDisabled();
    expect(screen.queryByTestId(VisualQueryAccessibility.generatedSQLText)).toBeNull();
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    expect(screen.queryByTestId(VisualQueryAccessibility.statementMenu)).toBeNull();
  });

  it("Start over calls onClearTabResults after clearing document", async () => {
    const user = userEvent.setup();
    const onClearTabResults = vi.fn();
    render(
      <VisualQueryCanvas
        tables={[{ name: "users", schema: "public" }]}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        onClearTabResults={onClearTabResults}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(onClearTabResults).toHaveBeenCalledTimes(1);
  });

  it("Run SELECT calls onRunQuery with exec SQL and does not show OK / N rows / ms", async () => {
    const user = userEvent.setup();
    const onRunQuery = vi.fn(async (_sql: { text: string; params: unknown[] }) => ({
      columns: ["id"],
      rows: [[1], [2]],
      rowsAffected: null,
      durationMs: 17,
    }));
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={true}
        onRunQuery={onRunQuery}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));

    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(onRunQuery).toHaveBeenCalledTimes(1));
    expect(onRunQuery.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({
        text: expect.stringMatching(/SELECT/i),
        params: expect.any(Array),
      }),
    );
    expect(document.querySelector(".vq-canvas__status")).toBeNull();
    expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(/OK\s*\//i);
    expect(document.querySelector(".vq-results-grid")).toBeNull();
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("Run SELECT with 0 rows does not show OK / 0 rows / X ms", async () => {
    const user = userEvent.setup();
    const onRunQuery = vi.fn(async () => ({
      columns: ["id"],
      rows: [],
      rowsAffected: 0,
      durationMs: 4,
    }));
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={true}
        onRunQuery={onRunQuery}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(onRunQuery).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".vq-canvas__status")).toBeNull();
    expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(/OK\s*\//i);
    expect(screen.queryByRole("table")).toBeNull();
  });

  it("clears stale Run success status when disconnected", async () => {
    const user = userEvent.setup();
    const onRunQuery = vi.fn(async () => ({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 9,
    }));
    const { rerender } = render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={true}
        onRunQuery={onRunQuery}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(onRunQuery).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".vq-canvas__status")).toBeNull();
    expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(/OK\s*\//i);

    rerender(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={false}
        onRunQuery={onRunQuery}
      />,
    );
    await waitFor(() =>
      expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(
        /OK\s*\//i,
      ),
    );
  });

  it("Run CREATE is gated in UI — Run is disabled and does not call onRunQuery", async () => {
    const user = userEvent.setup();
    const onRunQuery = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        onRunQuery={onRunQuery}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("createTable")));
    await user.type(screen.getByTestId(VisualQueryAccessibility.createTableNameField), "orders");
    await user.type(screen.getByTestId(VisualQueryAccessibility.createColumnNameField(0)), "id");
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    expect(onRunQuery).not.toHaveBeenCalled();
    expect(screen.queryByText(/only select queries can run/i)).toBeNull();
    expect(document.querySelector(".vq-canvas__status")).toBeNull();
  });

  it("Run failure does not show IpcError.message on the canvas and keeps canvas unlocked", async () => {
    const user = userEvent.setup();
    const onRunQuery = vi.fn(async () => {
      throw { kind: "syntax", message: "syntax error near SELECT", position: 0 };
    });
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={true}
        onRunQuery={onRunQuery}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(onRunQuery).toHaveBeenCalledTimes(1));
    expect(document.querySelector(".vq-canvas__status")).toBeNull();
    expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(/OK\s*\//i);
    expect(screen.queryByRole("table")).toBeNull();
    expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).not.toBeDisabled();
  });

  it("Start over during hanging onRunQuery clears results and ignores late OK strip", async () => {
    const user = userEvent.setup();
    let resolveRun!: (value: QueryResult) => void;
    const onRunQuery = vi.fn(
      () =>
        new Promise<QueryResult>((resolve) => {
          resolveRun = resolve;
        }),
    );
    const onClearTabResults = vi.fn();
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={["id"]}
        metadataErrorMessage={null}
        isConnected={true}
        onRunQuery={onRunQuery}
        onClearTabResults={onClearTabResults}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(onRunQuery).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(onClearTabResults).toHaveBeenCalled();
    resolveRun({ columns: ["id"], rows: [[1]], rowsAffected: null, durationMs: 9 });
    await waitFor(() =>
      expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(
        /OK\s*\//i,
      ),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).not.toBeDisabled();
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(onRunQuery).toHaveBeenCalledTimes(2));
  });
});

describe("VisualQueryCanvas History sheet (SP-4b)", () => {
  it("History on the toolbar opens the sheet", async () => {
    const user = userEvent.setup();
    const listHistory = vi.fn(async () => []);
    const historyStore = createHistoryStore({ listHistory } as unknown as DragonIpc);
    render(
      <VisualQueryCanvas
        tables={tables}
        columnNames={[]}
        metadataErrorMessage={null}
        isConnected={true}
        historyStore={historyStore}
        saveTextFile={vi.fn()}
      />,
    );
    expect(listHistory).not.toHaveBeenCalled();
    await user.click(screen.getByTestId(VisualQueryAccessibility.history));
    expect(await screen.findByTestId(HistoryAccessibility.sheet)).toBeInTheDocument();
  });
});
