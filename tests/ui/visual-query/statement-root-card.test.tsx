/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { CreateColumn, StatementKind } from "../../../src/core";
import { QueryDocument } from "../../../src/core";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { StatementRootCard } from "../../../src/ui/visual-query/statement-root-card";

afterEach(() => {
  cleanup();
});

type HarnessProps = {
  kind: StatementKind;
  initialDoc: QueryDocument;
};

function HarnessedStatementRootCard({ kind, initialDoc }: HarnessProps): React.JSX.Element {
  const [doc] = useState(() => initialDoc);
  const [, setRevision] = useState(0);
  const bump = (): void => setRevision((revision) => revision + 1);

  return (
    <StatementRootCard
      kind={kind}
      document={doc}
      onStartOver={() => {
        doc.startOver();
        bump();
      }}
      onSetCreateTableName={(name) => {
        doc.setCreateTableName(name);
        bump();
      }}
      onSetCreateColumns={(columns) => {
        doc.setCreateColumns(columns);
        bump();
      }}
    />
  );
}

describe("StatementRootCard", () => {
  it("UPDATE shows Coming soon and no create fields", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("update");
    render(
      <StatementRootCard
        kind="update"
        document={doc}
        onStartOver={() => {}}
        onSetCreateTableName={() => {}}
        onSetCreateColumns={() => {}}
      />,
    );
    expect(screen.getByText(/coming soon/i)).toBeInTheDocument();
    expect(screen.queryByTestId(VisualQueryAccessibility.createTableNameField)).toBeNull();
  });

  it("CREATE table name typing calls onSetCreateTableName", async () => {
    const user = userEvent.setup();
    const onSetCreateTableName = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    render(
      <StatementRootCard
        kind="createTable"
        document={doc}
        onStartOver={() => {}}
        onSetCreateTableName={onSetCreateTableName}
        onSetCreateColumns={() => {}}
      />,
    );
    await user.type(screen.getByTestId(VisualQueryAccessibility.createTableNameField), "orders");
    expect(onSetCreateTableName).toHaveBeenCalled();
    expect(onSetCreateTableName.mock.calls.at(-1)?.[0]).toContain("orders");
  });

  it("CREATE add column calls onSetCreateColumns", async () => {
    const user = userEvent.setup();
    const onSetCreateColumns = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    render(
      <StatementRootCard
        kind="createTable"
        document={doc}
        onStartOver={() => {}}
        onSetCreateTableName={() => {}}
        onSetCreateColumns={onSetCreateColumns}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.addCreateColumn));
    expect(onSetCreateColumns).toHaveBeenCalled();
    const cols = onSetCreateColumns.mock.calls.at(-1)?.[0];
    expect(Array.isArray(cols)).toBe(true);
    expect(cols.length).toBeGreaterThan(0);
    expect(cols[0]).toEqual(expect.objectContaining({ name: expect.any(String), type: expect.any(String) }));
  });

  it("start-over control fires onStartOver", async () => {
    const user = userEvent.setup();
    const onStartOver = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("delete");
    render(
      <StatementRootCard
        kind="delete"
        document={doc}
        onStartOver={onStartOver}
        onSetCreateTableName={() => {}}
        onSetCreateColumns={() => {}}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.deleteStatementRoot("delete")));
    expect(onStartOver).toHaveBeenCalled();
  });

  it("CREATE column name typing updates harnessed document and DOM", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    render(<HarnessedStatementRootCard kind="createTable" initialDoc={doc} />);

    const field = screen.getByTestId(VisualQueryAccessibility.createColumnNameField(0));
    await user.type(field, "id");
    expect(field).toHaveValue("id");
    expect(doc.createColumns[0]?.name).toBe("id");
  });

  it("CREATE column type picker updates type without changing name", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    doc.setCreateColumns([{ name: "amount", type: "text" }]);
    render(<HarnessedStatementRootCard kind="createTable" initialDoc={doc} />);

    const picker = screen.getByTestId(VisualQueryAccessibility.createColumnTypePicker(0));
    await user.selectOptions(picker, "number");
    expect(picker).toHaveValue("number");
    expect(doc.createColumns[0]).toEqual({ name: "amount", type: "number" });
  });

  it("CREATE add column appends exactly one empty text column", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    doc.setCreateColumns([{ name: "id", type: "text" }]);
    render(<HarnessedStatementRootCard kind="createTable" initialDoc={doc} />);

    await user.click(screen.getByTestId(VisualQueryAccessibility.addCreateColumn));
    expect(doc.createColumns).toEqual([
      { name: "id", type: "text" },
      { name: "", type: "text" },
    ]);
  });

  it("CREATE remove column drops only the selected row and disables last remove", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    doc.setCreateColumns([
      { name: "id", type: "text" },
      { name: "name", type: "text" },
    ]);
    render(<HarnessedStatementRootCard kind="createTable" initialDoc={doc} />);

    await user.click(screen.getByTestId(VisualQueryAccessibility.removeCreateColumn(1)));
    expect(doc.createColumns).toEqual([{ name: "id", type: "text" }]);
    expect(screen.getByTestId(VisualQueryAccessibility.removeCreateColumn(0))).toBeDisabled();
  });

  it("onSetCreateColumns receives fresh arrays rather than mutating getter results", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    const received: CreateColumn[][] = [];
    render(
      <StatementRootCard
        kind="createTable"
        document={doc}
        onStartOver={() => {}}
        onSetCreateTableName={() => {}}
        onSetCreateColumns={(columns) => {
          received.push(columns);
          columns.push({ name: "mutated", type: "text" });
        }}
      />,
    );

    await user.type(screen.getByTestId(VisualQueryAccessibility.createColumnNameField(0)), "x");
    expect(received.length).toBeGreaterThan(1);
    for (let i = 1; i < received.length; i++) {
      expect(received[i]).not.toBe(received[i - 1]);
    }
    expect(doc.createColumns.every((column) => column.name !== "mutated")).toBe(true);
  });
});
