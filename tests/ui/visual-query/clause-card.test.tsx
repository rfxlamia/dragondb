/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ClauseKind, OrderDirection, TableReference, WhereOperator } from "../../../src/core";
import { QueryDocument } from "../../../src/core";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { ClauseCard } from "../../../src/ui/visual-query/clause-card";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";

afterEach(() => {
  cleanup();
});

function docWithSelectFrom(): QueryDocument {
  const doc = new QueryDocument();
  doc.chooseStatement("select");
  doc.addClause("from");
  return doc;
}

type HarnessProps = {
  kind: ClauseKind;
  initialDoc: QueryDocument;
  tables?: TableReference[];
  columnNames?: string[];
  metadataErrorMessage?: string | null;
  onDelete?: () => void;
};

function HarnessedClauseCard({
  kind,
  initialDoc,
  tables = [],
  columnNames = [],
  metadataErrorMessage = null,
  onDelete = () => {},
}: HarnessProps): React.JSX.Element {
  const [doc] = useState(() => initialDoc);
  const [, setRevision] = useState(0);
  const bump = (): void => setRevision((revision) => revision + 1);

  return (
    <ClauseCard
      kind={kind}
      document={doc}
      tables={tables}
      columnNames={columnNames}
      metadataErrorMessage={metadataErrorMessage}
      onDelete={onDelete}
      onSetSelectColumns={(columns) => {
        doc.setSelectColumns(columns);
        bump();
      }}
      onSetFromTableText={(raw) => {
        doc.setFromTableText(raw);
        bump();
      }}
      onCommitFromTable={(raw) => {
        doc.commitFromTable(raw);
        bump();
      }}
      onSelectFromTable={(table) => {
        doc.selectFromTable(table.name, table.schema);
        bump();
      }}
      onSetWhereCondition={(column, op, value) => {
        doc.setWhereCondition(column, op, value);
        bump();
      }}
      onSetOrderBy={(column, direction) => {
        doc.setOrderBy(column, direction);
        bump();
      }}
      onSetLimitText={(text) => {
        doc.setLimitText(text);
        bump();
      }}
    />
  );
}

describe("ClauseCard", () => {
  it("shows clause helper copy", () => {
    const doc = docWithSelectFrom();
    render(
      <ClauseCard
        kind="from"
        document={doc}
        tables={[{ name: "users", schema: "public" }]}
        columnNames={[]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={() => {}}
      />,
    );
    expect(screen.getByText(VisualQueryCopy.helper("from"))).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.deleteClause("from"))).toBeInTheDocument();
  });

  it("FROM popover select calls onSelectFromTable", async () => {
    const user = userEvent.setup();
    const onSelectFromTable = vi.fn();
    const doc = docWithSelectFrom();
    render(
      <ClauseCard
        kind="from"
        document={doc}
        tables={[
          { name: "users", schema: "public" },
          { name: "events", schema: "analytics" },
        ]}
        columnNames={[]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={onSelectFromTable}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={() => {}}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "analytics.events" }));
    expect(onSelectFromTable).toHaveBeenCalledWith({ name: "events", schema: "analytics" });
  });

  it("LIMIT typing calls onSetLimitText", async () => {
    const user = userEvent.setup();
    const onSetLimitText = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("limit");
    render(
      <ClauseCard
        kind="limit"
        document={doc}
        tables={[]}
        columnNames={[]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={onSetLimitText}
      />,
    );
    await user.type(screen.getByTestId(VisualQueryAccessibility.limitField), "abc");
    expect(onSetLimitText).toHaveBeenCalled();
    expect(onSetLimitText.mock.calls.at(-1)?.[0]).toContain("abc");
  });

  it("WHERE column popover needs FROM message when from unset", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("where");
    render(
      <ClauseCard
        kind="where"
        document={doc}
        tables={[]}
        columnNames={[]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={() => {}}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.whereColumnPicker));
    expect(screen.getByText(VisualQueryCopy.columnPopoverNeedsFromMessage)).toBeInTheDocument();
  });

  it("SELECT all-columns toggle and ORDER BY direction call mutator props", async () => {
    const user = userEvent.setup();
    const onSetSelectColumns = vi.fn();
    const onSetOrderBy = vi.fn();
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("orderBy");
    const { rerender } = render(
      <ClauseCard
        kind="select"
        document={doc}
        tables={[]}
        columnNames={["id"]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={onSetSelectColumns}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={() => {}}
        onSetLimitText={() => {}}
      />,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.allColumnsToggle));
    expect(onSetSelectColumns).toHaveBeenCalled();

    rerender(
      <ClauseCard
        kind="orderBy"
        document={doc}
        tables={[]}
        columnNames={["id"]}
        metadataErrorMessage={null}
        onDelete={() => {}}
        onSetSelectColumns={() => {}}
        onSetFromTableText={() => {}}
        onCommitFromTable={() => {}}
        onSelectFromTable={() => {}}
        onSetWhereCondition={() => {}}
        onSetOrderBy={onSetOrderBy}
        onSetLimitText={() => {}}
      />,
    );
    await user.selectOptions(screen.getByTestId(VisualQueryAccessibility.orderByDirectionField), "desc");
    expect(onSetOrderBy).toHaveBeenCalled();
  });

  it("FROM field typing, commit, and picker update the harnessed document", async () => {
    const user = userEvent.setup();
    const doc = docWithSelectFrom();
    render(
      <HarnessedClauseCard
        kind="from"
        initialDoc={doc}
        tables={[{ name: "users", schema: "public" }]}
      />,
    );

    const field = screen.getByTestId(VisualQueryAccessibility.fromTableField);
    await user.clear(field);
    await user.type(field, "analytics.events");
    expect(field).toHaveValue("analytics.events");

    await user.keyboard("{Enter}");
    expect(field).toHaveValue("analytics.events");

    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(screen.getByRole("button", { name: "users" }));
    expect(field).toHaveValue("users");
    expect(doc.fromTable).toEqual({ name: "users", schema: "public" });
  });

  it("SELECT column field and picker update the harnessed projection", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.commitFromTable("users");

    render(
      <HarnessedClauseCard
        kind="select"
        initialDoc={doc}
        columnNames={["id", "email"]}
      />,
    );

    await user.click(screen.getByTestId(VisualQueryAccessibility.allColumnsToggle));
    const columnsField = screen.getByTestId(VisualQueryAccessibility.selectColumnsField);
    expect(columnsField).toBeInTheDocument();

    await user.type(columnsField, "id, email");
    expect(columnsField).toHaveValue("id, email");
    expect(doc.selectProjection).toEqual({ kind: "columns", columns: ["id", "email"] });

    await user.click(screen.getByTestId(VisualQueryAccessibility.selectColumnsPicker));
    await user.click(screen.getByRole("button", { name: "id" }));
    expect(doc.selectProjection).toEqual({ kind: "columns", columns: ["id", "email"] });
  });

  it("WHERE edits preserve other fields in the harnessed document", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.commitFromTable("users");
    doc.addClause("where");

    render(
      <HarnessedClauseCard
        kind="where"
        initialDoc={doc}
        columnNames={["status", "amount"]}
      />,
    );

    await user.click(screen.getByTestId(VisualQueryAccessibility.whereColumnPicker));
    await user.click(screen.getByRole("button", { name: "status" }));
    expect(screen.getByTestId(VisualQueryAccessibility.whereColumnField)).toHaveValue("status");

    await user.selectOptions(screen.getByTestId(VisualQueryAccessibility.whereOperatorField), "contains");
    await user.type(screen.getByTestId(VisualQueryAccessibility.whereValueField), "open");
    expect(doc.whereCondition).toEqual({
      column: "status",
      op: "contains",
      value: "open",
    });
  });

  it("ORDER BY column picker and direction update the harnessed document", async () => {
    const user = userEvent.setup();
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.commitFromTable("events");
    doc.addClause("orderBy");

    render(
      <HarnessedClauseCard
        kind="orderBy"
        initialDoc={doc}
        columnNames={["event_id", "created_at"]}
      />,
    );

    await user.click(screen.getByTestId(VisualQueryAccessibility.orderByColumnPicker));
    await user.click(screen.getByRole("button", { name: "event_id" }));
    expect(screen.getByTestId(VisualQueryAccessibility.orderByColumnField)).toHaveValue("event_id");

    await user.selectOptions(screen.getByTestId(VisualQueryAccessibility.orderByDirectionField), "desc");
    expect(doc.orderBy).toEqual({ column: "event_id", direction: "desc" });
  });

  it("delete button calls onDelete for each clause kind", async () => {
    const user = userEvent.setup();
    const kinds: ClauseKind[] = ["select", "from", "where", "orderBy", "limit"];

    for (const kind of kinds) {
      const onDelete = vi.fn();
      const doc = new QueryDocument();
      doc.chooseStatement("select");
      if (kind !== "select") {
        doc.addClause(kind);
      }

      const { unmount } = render(
        <ClauseCard
          kind={kind}
          document={doc}
          tables={[]}
          columnNames={[]}
          metadataErrorMessage={null}
          onDelete={onDelete}
          onSetSelectColumns={() => {}}
          onSetFromTableText={() => {}}
          onCommitFromTable={() => {}}
          onSelectFromTable={() => {}}
          onSetWhereCondition={() => {}}
          onSetOrderBy={() => {}}
          onSetLimitText={() => {}}
        />,
      );

      await user.click(screen.getByTestId(VisualQueryAccessibility.deleteClause(kind)));
      expect(onDelete).toHaveBeenCalledOnce();
      unmount();
    }
  });
});
