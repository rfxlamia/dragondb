import type { RowOperationError, RowOperationErrorKind } from "../../ipc/contract";

const MESSAGES: Record<RowOperationErrorKind, string> = {
  noPrimaryKey: "This table has no primary key, so the row cannot be changed safely.",
  noTableSelected: "Select a table before changing rows.",
  noRowsSelected: "Select at least one row.",
  metadataFetchFailed: "Column details could not be loaded. Try refreshing the table.",
  updateFailed: "The row could not be saved. Your changes are still here.",
  deleteFailed: "The selected rows could not be deleted.",
};

const KINDS = new Set<RowOperationErrorKind>(Object.keys(MESSAGES) as RowOperationErrorKind[]);

export function isRowOperationError(error: unknown): error is RowOperationError {
  if (typeof error !== "object" || error === null) return false;
  const kind = (error as { kind?: unknown }).kind;
  return typeof kind === "string" && KINDS.has(kind as RowOperationErrorKind);
}

/** Map the six IPC row-operation kinds to human copy; never surface raw backend detail. */
export function rowOperationErrorMessage(error: unknown): string {
  if (isRowOperationError(error)) return MESSAGES[error.kind];
  return MESSAGES.updateFailed;
}
