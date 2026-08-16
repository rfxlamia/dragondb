import type { QueryFolderDto } from "../../ipc/contract";
import { QueriesCopy } from "./queries-copy";

export type QueriesSheet =
  | { kind: "rename"; queryId: string; name: string }
  | { kind: "delete"; queryIds: string[] }
  | { kind: "move"; queryId: string }
  | { kind: "delete-folder"; folderId: string; empty: boolean }
  | { kind: "rename-folder"; folderId: string; name: string }
  | { kind: "new-folder"; queryId: string; name: string };

export type QueriesColumnSheetsProps = {
  sheet: QueriesSheet;
  folders: QueryFolderDto[];
  renameBlank: boolean;
  onSheetChange: (sheet: QueriesSheet | null) => void;
  onRenameQuery: (id: string, name: string) => void;
  onDeleteQuery: (id: string) => void;
  onMoveQuery: (id: string, folderId: string | null) => void;
  onDeleteFolder: (id: string, deleteQueries: boolean) => void;
  onRenameFolder?: (id: string, name: string) => void;
  onCreateFolder?: (name: string) => Promise<{ id: string }> | { id: string };
  onDeleted: () => void;
};

export function QueriesColumnSheets(props: QueriesColumnSheetsProps): React.JSX.Element | null {
  const {
    sheet,
    folders,
    renameBlank,
    onSheetChange,
    onRenameQuery,
    onDeleteQuery,
    onMoveQuery,
    onDeleteFolder,
    onRenameFolder,
    onCreateFolder,
    onDeleted,
  } = props;

  if (sheet.kind === "rename") {
    return (
      <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.rename}>
        <label htmlFor="queries-rename-name">
          {QueriesCopy.name}
          <input
            id="queries-rename-name"
            value={sheet.name}
            onChange={(event) =>
              onSheetChange({ kind: "rename", queryId: sheet.queryId, name: event.target.value })
            }
          />
        </label>
        <button
          type="button"
          className="queries-column__sheet-primary"
          disabled={renameBlank}
          onClick={() => {
            if (renameBlank) return;
            onRenameQuery(sheet.queryId, sheet.name.trim());
            onSheetChange(null);
          }}
        >
          {QueriesCopy.save}
        </button>
        <button type="button" onClick={() => onSheetChange(null)}>
          {QueriesCopy.cancel}
        </button>
      </div>
    );
  }

  if (sheet.kind === "delete") {
    return (
      <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.delete}>
        <button
          type="button"
          className="queries-column__sheet-primary"
          onClick={() => {
            for (const id of sheet.queryIds) onDeleteQuery(id);
            onSheetChange(null);
            onDeleted();
          }}
        >
          {QueriesCopy.confirmDelete}
        </button>
        <button type="button" onClick={() => onSheetChange(null)}>
          {QueriesCopy.cancel}
        </button>
      </div>
    );
  }

  if (sheet.kind === "move") {
    return (
      <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.move}>
        <button
          type="button"
          aria-label="Unfiled"
          onClick={() => {
            onMoveQuery(sheet.queryId, null);
            onSheetChange(null);
          }}
        >
          {QueriesCopy.noFolder}
        </button>
        {folders.map((folder) => (
          <button
            type="button"
            key={folder.id}
            onClick={() => {
              onMoveQuery(sheet.queryId, folder.id);
              onSheetChange(null);
            }}
          >
            {folder.name}
          </button>
        ))}
        {onCreateFolder ? (
          <button
            type="button"
            aria-label="Create"
            onClick={() => onSheetChange({ kind: "new-folder", queryId: sheet.queryId, name: "" })}
          >
            {QueriesCopy.newFolder}
          </button>
        ) : null}
        <button type="button" onClick={() => onSheetChange(null)}>
          {QueriesCopy.cancel}
        </button>
      </div>
    );
  }

  if (sheet.kind === "new-folder") {
    return (
      <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.newFolder}>
        <label htmlFor="queries-new-folder-name">
          {QueriesCopy.name}
          <input
            id="queries-new-folder-name"
            value={sheet.name}
            onChange={(event) =>
              onSheetChange({
                kind: "new-folder",
                queryId: sheet.queryId,
                name: event.target.value,
              })
            }
          />
        </label>
        <button
          type="button"
          className="queries-column__sheet-primary"
          disabled={renameBlank}
          onClick={() => {
            if (renameBlank || !onCreateFolder) return;
            const queryId = sheet.queryId;
            const name = sheet.name.trim();
            void Promise.resolve(onCreateFolder(name)).then((folder) => {
              if (folder && "id" in folder) onMoveQuery(queryId, folder.id);
            });
            onSheetChange(null);
          }}
        >
          {QueriesCopy.save}
        </button>
        <button type="button" onClick={() => onSheetChange(null)}>
          {QueriesCopy.cancel}
        </button>
      </div>
    );
  }

  if (sheet.kind === "rename-folder" && onRenameFolder) {
    return (
      <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.renameFolder}>
        <label htmlFor="queries-rename-folder-name">
          {QueriesCopy.name}
          <input
            id="queries-rename-folder-name"
            value={sheet.name}
            onChange={(event) =>
              onSheetChange({
                kind: "rename-folder",
                folderId: sheet.folderId,
                name: event.target.value,
              })
            }
          />
        </label>
        <button
          type="button"
          className="queries-column__sheet-primary"
          disabled={renameBlank}
          onClick={() => {
            if (renameBlank) return;
            onRenameFolder(sheet.folderId, sheet.name.trim());
            onSheetChange(null);
          }}
        >
          {QueriesCopy.save}
        </button>
        <button type="button" onClick={() => onSheetChange(null)}>
          {QueriesCopy.cancel}
        </button>
      </div>
    );
  }

  if (sheet.kind === "delete-folder") {
    return (
      <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.deleteFolder}>
        {sheet.empty ? (
          <button
            type="button"
            className="queries-column__sheet-primary"
            onClick={() => {
              onDeleteFolder(sheet.folderId, false);
              onSheetChange(null);
            }}
          >
            {QueriesCopy.confirmDelete}
          </button>
        ) : (
          <>
            <button
              type="button"
              onClick={() => {
                onDeleteFolder(sheet.folderId, false);
                onSheetChange(null);
              }}
            >
              {QueriesCopy.deleteFolderOnly}
            </button>
            <button
              type="button"
              onClick={() => {
                onDeleteFolder(sheet.folderId, true);
                onSheetChange(null);
              }}
            >
              {QueriesCopy.deleteFolderAndQueries}
            </button>
          </>
        )}
        <button type="button" onClick={() => onSheetChange(null)}>
          {QueriesCopy.cancel}
        </button>
      </div>
    );
  }

  return null;
}
