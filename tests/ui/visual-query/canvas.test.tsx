/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueryDocument } from "../../../src/core";
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

describe("VisualQueryCanvas layout chrome", () => {
  it("places stage and SQL preview as siblings under the canvas body", async () => {
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
    const stage = body?.querySelector(":scope > .vq-canvas__stage");
    const preview = body?.querySelector(":scope > .vq-sql-preview");
    expect(stage).not.toBeNull();
    expect(preview).not.toBeNull();
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

  it("docks SQL preview without stealing stage flex growth", () => {
    expect(css).toMatch(/\.vq-canvas__stage\s*\{[^}]*flex:\s*1/);
    expect(css).toMatch(/\.vq-sql-preview\s*\{[^}]*flex:\s*0\s+0\s+auto/);
    expect(css).toMatch(/\.vq-sql-preview\s*\{[^}]*max-height:\s*40vh/);
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

  it("shows canRun help on status strip when SELECT incomplete", async () => {
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
    expect(screen.getByText(/table/i)).toBeInTheDocument();
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

  it("CREATE path updates live preview text", async () => {
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
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("createTable")));
    await user.type(screen.getByTestId(VisualQueryAccessibility.createTableNameField), "orders");
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText).textContent).toMatch(
      /orders/i,
    );
  });

  it("UPDATE shows Coming soon and preview em dash", async () => {
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
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("update")));
    expect(screen.getAllByText(/coming soon/i).length).toBeGreaterThanOrEqual(1);
    expect(document.querySelector(".vq-canvas__status")).toHaveTextContent("Coming soon");
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
    const initialPreview = screen.getByTestId(
      VisualQueryAccessibility.generatedSQLText,
    ).textContent;

    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText).textContent).not.toBe(
      initialPreview,
    );

    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("from"))).toBeInTheDocument();

    const fromField = screen.getByTestId(VisualQueryAccessibility.fromTableField);
    await user.type(fromField, "users");
    await user.keyboard("{Enter}");
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

    const sql = screen.getByTestId(VisualQueryAccessibility.generatedSQLText).textContent ?? "";
    expect(sql).toMatch(/WHERE/i);
    expect(sql).toContain("42");
  });
});
