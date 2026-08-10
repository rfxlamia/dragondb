import type { ClauseKind, StatementKind } from "../../core";

function clauseKey(kind: ClauseKind): string {
  switch (kind) {
    case "select":
      return "select";
    case "from":
      return "from";
    case "where":
      return "where";
    case "orderBy":
      return "orderBy";
    case "limit":
      return "limit";
    case "join":
      return "join";
  }
}

function statementKey(kind: StatementKind): string {
  switch (kind) {
    case "select":
      return "select";
    case "createTable":
      return "createTable";
    case "update":
      return "update";
    case "delete":
      return "delete";
  }
}

function clauseCard(kind: ClauseKind): string {
  return `visualQuery.clauseCard.${clauseKey(kind)}`;
}

function deleteClause(kind: ClauseKind): string {
  return `visualQuery.deleteClause.${clauseKey(kind)}`;
}

function statementMenuItem(kind: StatementKind): string {
  return `visualQuery.statementMenu.${statementKey(kind)}`;
}

function clauseMenuItem(kind: ClauseKind): string {
  return `visualQuery.clauseMenu.${clauseKey(kind)}`;
}

function deleteStatementRoot(kind: StatementKind): string {
  return `visualQuery.deleteRoot.${statementKey(kind)}`;
}

function createColumnNameField(index: number): string {
  return `visualQuery.createColumn.${index}.name`;
}

function createColumnTypePicker(index: number): string {
  return `visualQuery.createColumn.${index}.type`;
}

function removeCreateColumn(index: number): string {
  return `visualQuery.createColumn.${index}.remove`;
}

function schemaPopoverItem(title: string, item: string): string {
  return `visualQuery.schemaPopover.${title.toLowerCase()}.item.${item}`;
}

function allInteractiveIdentifiers(): string[] {
  const ids: string[] = [
    VisualQueryAccessibility.modeToggle,
    VisualQueryAccessibility.initialAddBlock,
    VisualQueryAccessibility.trailingAddBlock,
    VisualQueryAccessibility.statementMenu,
    VisualQueryAccessibility.clauseMenu,
    VisualQueryAccessibility.startOver,
    VisualQueryAccessibility.runQuery,
    VisualQueryAccessibility.viewGeneratedSQL,
    VisualQueryAccessibility.generatedSQLText,
    VisualQueryAccessibility.copySQL,
    VisualQueryAccessibility.generatedSQLDone,
    VisualQueryAccessibility.allColumnsToggle,
    VisualQueryAccessibility.selectColumnsField,
    VisualQueryAccessibility.selectColumnsPicker,
    VisualQueryAccessibility.fromTableField,
    VisualQueryAccessibility.fromTablePicker,
    VisualQueryAccessibility.whereColumnField,
    VisualQueryAccessibility.whereColumnPicker,
    VisualQueryAccessibility.whereOperatorField,
    VisualQueryAccessibility.whereValueField,
    VisualQueryAccessibility.orderByColumnField,
    VisualQueryAccessibility.orderByColumnPicker,
    VisualQueryAccessibility.orderByDirectionField,
    VisualQueryAccessibility.limitField,
    VisualQueryAccessibility.createTableNameField,
    VisualQueryAccessibility.createColumnsList,
    VisualQueryAccessibility.addCreateColumn,
    VisualQueryAccessibility.schemaPopoverSearch,
    VisualQueryAccessibility.schemaPopoverList,
    VisualQueryAccessibility.confirmCreateContinue,
    VisualQueryAccessibility.confirmCreateCancel,
  ];

  const clauseKinds: ClauseKind[] = ["select", "from", "where", "orderBy", "limit", "join"];
  for (const kind of clauseKinds) {
    ids.push(clauseCard(kind));
    ids.push(deleteClause(kind));
    ids.push(clauseMenuItem(kind));
  }

  const statementKinds: StatementKind[] = ["select", "createTable", "update", "delete"];
  for (const kind of statementKinds) {
    ids.push(statementMenuItem(kind));
    ids.push(deleteStatementRoot(kind));
  }

  return ids;
}

/** Stable accessibility identifiers for visual query interactive controls. */
export const VisualQueryAccessibility = {
  modeToggle: "visualQuery.modeToggle",
  initialAddBlock: "visualQuery.initialAddBlock",
  trailingAddBlock: "visualQuery.trailingAddBlock",
  statementMenu: "visualQuery.statementMenu",
  clauseMenu: "visualQuery.clauseMenu",
  startOver: "visualQuery.startOver",
  runQuery: "visualQuery.runQuery",
  viewGeneratedSQL: "visualQuery.viewGeneratedSQL",
  generatedSQLText: "visualQuery.generatedSQLText",
  copySQL: "visualQuery.copySQL",
  generatedSQLDone: "visualQuery.generatedSQLDone",
  allColumnsToggle: "visualQuery.allColumnsToggle",
  selectColumnsField: "visualQuery.selectColumnsField",
  selectColumnsPicker: "visualQuery.selectColumnsPicker",
  fromTableField: "visualQuery.fromTableField",
  fromTablePicker: "visualQuery.fromTablePicker",
  whereColumnField: "visualQuery.whereColumnField",
  whereColumnPicker: "visualQuery.whereColumnPicker",
  whereOperatorField: "visualQuery.whereOperatorField",
  whereValueField: "visualQuery.whereValueField",
  orderByColumnField: "visualQuery.orderByColumnField",
  orderByColumnPicker: "visualQuery.orderByColumnPicker",
  orderByDirectionField: "visualQuery.orderByDirectionField",
  limitField: "visualQuery.limitField",
  createTableNameField: "visualQuery.createTableNameField",
  createColumnsList: "visualQuery.createColumnsList",
  addCreateColumn: "visualQuery.addCreateColumn",
  schemaPopoverSearch: "visualQuery.schemaPopoverSearch",
  schemaPopoverList: "visualQuery.schemaPopoverList",
  confirmCreateContinue: "visualQuery.confirmCreateContinue",
  confirmCreateCancel: "visualQuery.confirmCreateCancel",
  clauseCard,
  deleteClause,
  statementMenuItem,
  clauseMenuItem,
  deleteStatementRoot,
  createColumnNameField,
  createColumnTypePicker,
  removeCreateColumn,
  schemaPopoverItem,
  get allInteractiveIdentifiers() {
    return allInteractiveIdentifiers();
  },
} as const;
