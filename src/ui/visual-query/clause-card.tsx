import { useState } from "react";
import type {
  ClauseKind,
  OrderDirection,
  QueryDocument,
  TableReference,
  WhereOperator,
} from "../../core";
import { formatTableDisplayName } from "../../ipc/table-ref";
import { VisualQueryAccessibility } from "./accessibility";
import { ClauseCardFields } from "./clause-card-fields";
import { VisualQueryCopy } from "./copy";
import { SchemaFieldPopover } from "./schema-field-popover";
import "./visual-query.css";

export type ClauseCardProps = {
  kind: ClauseKind;
  document: QueryDocument;
  tables: TableReference[];
  columnNames: string[];
  metadataErrorMessage: string | null;
  onDelete: () => void;
  onSetSelectColumns: (columns: string[]) => void;
  onSetFromTableText: (raw: string) => void;
  onCommitFromTable: (raw: string) => void;
  onSelectFromTable: (table: TableReference) => void;
  onSetWhereCondition: (column: string, op: WhereOperator, value: string | null) => void;
  onSetOrderBy: (column: string, direction: OrderDirection) => void;
  onSetLimitText: (text: string) => void;
};

type SchemaPopoverMode = "tables" | "columns";

export function ClauseCard(props: ClauseCardProps): React.JSX.Element {
  const {
    kind,
    document,
    tables,
    columnNames,
    metadataErrorMessage,
    onDelete,
    onSetSelectColumns,
    onSetFromTableText,
    onCommitFromTable,
    onSelectFromTable,
    onSetWhereCondition,
    onSetOrderBy,
    onSetLimitText,
  } = props;

  const [showSchemaPopover, setShowSchemaPopover] = useState(false);
  const [popoverMode, setPopoverMode] = useState<SchemaPopoverMode>("columns");

  const isRootSelect = kind === "select";
  const needsFrom = document.fromTable === null;

  function openSchemaPopover(mode: SchemaPopoverMode): void {
    setPopoverMode(mode);
    setShowSchemaPopover(true);
  }

  function applyColumnSelection(name: string): void {
    switch (kind) {
      case "select": {
        const projection = document.selectProjection;
        if (projection.kind === "columns") {
          const next = projection.columns.filter(
            (column) => column.trim().length > 0,
          );
          if (!next.includes(name)) {
            next.push(name);
          }
          onSetSelectColumns(next);
        } else {
          onSetSelectColumns([name]);
        }
        break;
      }
      case "where": {
        const op = document.whereCondition?.op ?? "equals";
        const value = document.whereCondition?.value ?? null;
        onSetWhereCondition(name, op, value);
        break;
      }
      case "orderBy": {
        const direction = document.orderBy?.direction ?? "asc";
        onSetOrderBy(name, direction);
        break;
      }
      case "from":
      case "limit":
      case "join":
        break;
    }
    setShowSchemaPopover(false);
  }

  return (
    <div
      className="vq-clause-card"
      data-testid={VisualQueryAccessibility.clauseCard(kind)}
    >
      <div className="vq-clause-card__header">
        <div className="vq-clause-card__titles">
          <div className="vq-clause-card__title">{VisualQueryCopy.clauseTitle(kind)}</div>
          <div className="vq-clause-card__helper">{VisualQueryCopy.helper(kind)}</div>
        </div>
        <button
          type="button"
          className="vq-clause-card__delete"
          title={isRootSelect ? VisualQueryCopy.startOverTitle : VisualQueryCopy.deleteClauseTitle}
          onClick={onDelete}
          data-testid={VisualQueryAccessibility.deleteClause(kind)}
        >
          ×
        </button>
      </div>

      <ClauseCardFields
        kind={kind}
        document={document}
        onSetSelectColumns={onSetSelectColumns}
        onSetFromTableText={onSetFromTableText}
        onCommitFromTable={onCommitFromTable}
        onSetWhereCondition={onSetWhereCondition}
        onSetOrderBy={onSetOrderBy}
        onSetLimitText={onSetLimitText}
        onOpenSchemaPopover={openSchemaPopover}
      />

      {showSchemaPopover ? (
        <div className="vq-clause-card__popover">
          {popoverMode === "tables" ? (
            <SchemaFieldPopover
              title="Tables"
              items={tables}
              itemTitle={formatTableDisplayName}
              onSelect={(table) => {
                onSelectFromTable(table);
                setShowSchemaPopover(false);
              }}
            />
          ) : (
            <SchemaFieldPopover
              title="Columns"
              items={needsFrom ? [] : columnNames}
              itemTitle={(name) => name}
              needsFromMessage={
                needsFrom ? VisualQueryCopy.columnPopoverNeedsFromMessage : null
              }
              errorMessage={needsFrom ? null : metadataErrorMessage}
              onSelect={applyColumnSelection}
            />
          )}
        </div>
      ) : null}
    </div>
  );
}
