import { useState } from "react";
import type { ClauseKind, StatementKind, TableReference } from "../../core";
import { CanvasPresentation, QueryDocument, canRun, generateSQL } from "../../core";
import { sameTable } from "../../ipc/table-ref";
import { VisualQueryAccessibility } from "./accessibility";
import { ClauseCard } from "./clause-card";
import { VisualQueryCopy } from "./copy";
import { GeneratedSQLPreview } from "./generated-sql-preview";
import { StatementPicker } from "./statement-picker";
import { StatementRootCard } from "./statement-root-card";
import { VisualQueryToolbar } from "./toolbar";
import "./visual-query.css";

export type VisualQueryCanvasProps = {
  tables: TableReference[];
  columnNames: string[];
  metadataErrorMessage: string | null;
  isConnected: boolean;
  /**
   * Uncontrolled by default: canvas owns one QueryDocument instance for the
   * lifetime of the mount. If `document` is passed, canvas still mutates that
   * instance in place and bumps an internal revision; it does NOT clone.
   * There is no prop→state sync on later document identity changes — pass a
   * stable instance (tests) or omit the prop (App).
   */
  document?: QueryDocument;
  onDocumentChange?: (doc: QueryDocument) => void;
  /** Fires when committed FROM identity changes (including to null). */
  onCommittedFromChange?: (table: TableReference | null) => void;
};

export function VisualQueryCanvas(props: VisualQueryCanvasProps): React.JSX.Element {
  const {
    tables,
    columnNames,
    metadataErrorMessage,
    isConnected,
    onDocumentChange,
    onCommittedFromChange,
  } = props;

  const [doc] = useState(() => props.document ?? new QueryDocument());
  const [revision, setRevision] = useState(0);
  void revision;

  const [showStatementPicker, setShowStatementPicker] = useState(false);
  const [showClauseMenu, setShowClauseMenu] = useState(false);

  const presentation = new CanvasPresentation(doc);
  const eligibility = canRun(doc, isConnected);
  const sql = generateSQL(doc)?.display ?? VisualQueryCopy.sqlPreviewEmpty;
  const showStatusStrip =
    !eligibility.isRunnable &&
    eligibility.helpMessage !== null &&
    !(presentation.showsStatementRootCard && eligibility.helpMessage === "Coming soon");

  function mutate(fn: (d: QueryDocument) => void): void {
    const before = doc.committedFromTable;
    fn(doc);
    const after = doc.committedFromTable;
    setRevision((r) => r + 1);
    onDocumentChange?.(doc);
    if (!sameTable(before, after)) {
      onCommittedFromChange?.(after);
    }
  }

  function handleChooseStatement(kind: StatementKind): void {
    mutate((d) => {
      d.chooseStatement(kind);
    });
    setShowStatementPicker(false);
  }

  function handleAddClause(kind: ClauseKind): void {
    mutate((d) => {
      d.addClause(kind);
    });
    setShowClauseMenu(false);
  }

  function handleDeleteClause(kind: ClauseKind): void {
    if (kind === "select") {
      mutate((d) => {
        d.startOver();
      });
      return;
    }
    mutate((d) => {
      d.removeClause(kind);
    });
  }

  const statementKind = presentation.statementKind;

  return (
    <div className="vq-canvas">
      <VisualQueryToolbar
        canStartOver={doc.statementKind !== null}
        onStartOver={() => {
          mutate((d) => {
            d.startOver();
          });
        }}
      />

      {metadataErrorMessage ? (
        <div className="vq-canvas__metadata-error">{metadataErrorMessage}</div>
      ) : null}

      {showStatusStrip ? (
        <div className="vq-canvas__status">{eligibility.helpMessage}</div>
      ) : null}

      <div className="vq-canvas__body">
        <div className="vq-canvas__chain">
          {presentation.showsInitialAddButton ? (
            <div className="vq-canvas__empty">
              <div className="vq-canvas__empty-title">{VisualQueryCopy.emptyCanvasTitle}</div>
              <div className="vq-canvas__empty-body">{VisualQueryCopy.emptyCanvasBody}</div>
              <button
                type="button"
                className="vq-canvas__add-block"
                data-testid={VisualQueryAccessibility.initialAddBlock}
                onClick={() => setShowStatementPicker(true)}
              >
                {VisualQueryCopy.addBlockTitle}
              </button>
              {showStatementPicker ? (
                <StatementPicker onChoose={handleChooseStatement} />
              ) : null}
            </div>
          ) : null}

          {presentation.showsStatementRootCard && statementKind !== null ? (
            <StatementRootCard
              kind={statementKind}
              document={doc}
              onStartOver={() => {
                mutate((d) => {
                  d.startOver();
                });
              }}
              onSetCreateTableName={(name) => {
                mutate((d) => {
                  d.setCreateTableName(name);
                });
              }}
              onSetCreateColumns={(columns) => {
                mutate((d) => {
                  d.setCreateColumns(columns);
                });
              }}
            />
          ) : null}

          {presentation.visibleClauseKinds.map((kind) => (
            <ClauseCard
              key={kind}
              kind={kind}
              document={doc}
              tables={tables}
              columnNames={columnNames}
              metadataErrorMessage={metadataErrorMessage}
              onDelete={() => handleDeleteClause(kind)}
              onSetSelectColumns={(columns) => {
                mutate((d) => {
                  d.setSelectColumns(columns);
                });
              }}
              onSetFromTableText={(raw) => {
                mutate((d) => {
                  d.setFromTableText(raw);
                });
              }}
              onCommitFromTable={(raw) => {
                mutate((d) => {
                  d.commitFromTable(raw);
                });
              }}
              onSelectFromTable={(table) => {
                mutate((d) => {
                  d.selectFromTable(table.name, table.schema);
                });
              }}
              onSetWhereCondition={(column, op, value) => {
                mutate((d) => {
                  d.setWhereCondition(column, op, value);
                });
              }}
              onSetOrderBy={(column, direction) => {
                mutate((d) => {
                  d.setOrderBy(column, direction);
                });
              }}
              onSetLimitText={(text) => {
                mutate((d) => {
                  d.setLimitText(text);
                });
              }}
            />
          ))}

          {presentation.showsTrailingAddButton ? (
            <>
              <button
                type="button"
                className="vq-canvas__add-block"
                data-testid={VisualQueryAccessibility.trailingAddBlock}
                onClick={() => setShowClauseMenu(true)}
              >
                {VisualQueryCopy.addBlockTitle}
              </button>
              {showClauseMenu ? (
                <div className="vq-clause-menu" data-testid={VisualQueryAccessibility.clauseMenu}>
                  {VisualQueryCopy.clauseMenuItems(doc).map((item) => (
                    <button
                      key={item.kind}
                      type="button"
                      className="vq-clause-menu__item"
                      data-testid={VisualQueryAccessibility.clauseMenuItem(item.kind)}
                      onClick={() => handleAddClause(item.kind)}
                    >
                      <div className="vq-clause-menu__item-title">{item.title}</div>
                      <div className="vq-clause-menu__item-helper">{item.helper}</div>
                    </button>
                  ))}
                </div>
              ) : null}
            </>
          ) : null}
        </div>

        <GeneratedSQLPreview sql={sql} />
      </div>
    </div>
  );
}
