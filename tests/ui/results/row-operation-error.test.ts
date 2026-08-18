import { describe, expect, it } from "vitest";
import type { RowOperationErrorKind } from "../../../src/ipc/contract";
import { rowOperationErrorMessage } from "../../../src/ui/results/row-operation-error";

const expected: Record<RowOperationErrorKind, string> = {
  noPrimaryKey: "This table has no primary key, so the row cannot be changed safely.",
  noTableSelected: "Select a table before changing rows.",
  noRowsSelected: "Select at least one row.",
  metadataFetchFailed: "Column details could not be loaded. Try refreshing the table.",
  updateFailed: "The row could not be saved. Your changes are still here.",
  deleteFailed: "The selected rows could not be deleted.",
};

describe("row operation messages", () => {
  it.each(Object.entries(expected) as [RowOperationErrorKind, string][])(
    "maps %s to stable human copy",
    (kind, message) => {
      expect(rowOperationErrorMessage({ kind, message: "raw backend detail" })).toBe(message);
    },
  );
});
