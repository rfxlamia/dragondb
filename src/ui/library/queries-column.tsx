import { useMemo, useState } from "react";
import type { QueryFolderDto, SavedQueryDto } from "../../ipc/contract";
import { QueriesAccessibility } from "./queries-accessibility";
import { QueriesCopy } from "./queries-copy";
import "./queries.css";

export type QueriesColumnProps = {
  queries: SavedQueryDto[];
  folders: QueryFolderDto[];
  selectedQueryId: string | null;
  onSelectQuery: (id: string) => void;
  onNewQuery: () => void;
  onRenameQuery: (id: string, name: string) => void;
  onDeleteQuery: (id: string) => void;
  onMoveQuery: (id: string, folderId: string) => void;
  onDeleteFolder: (id: string, deleteQueries: boolean) => void;
};

type Sheet =
  | { kind: "rename"; queryId: string; name: string }
  | { kind: "delete"; queryId: string }
  | { kind: "move"; queryId: string }
  | { kind: "delete-folder"; folderId: string };

export function QueriesColumn(props: QueriesColumnProps): React.JSX.Element {
  const {
    queries,
    folders,
    selectedQueryId,
    onSelectQuery,
    onNewQuery,
    onRenameQuery,
    onDeleteQuery,
    onMoveQuery,
    onDeleteFolder,
  } = props;
  const [sheet, setSheet] = useState<Sheet | null>(null);

  const selected = queries.find((query) => query.id === selectedQueryId) ?? null;
  const selectedFolderId =
    selected !== null && selected.folderId !== null ? selected.folderId : null;
  const unfiled = useMemo(() => queries.filter((query) => query.folderId === null), [queries]);
  const queriesByFolder = useMemo(() => {
    const grouped = new Map<string, SavedQueryDto[]>();
    for (const query of queries) {
      if (query.folderId === null) continue;
      const list = grouped.get(query.folderId) ?? [];
      list.push(query);
      grouped.set(query.folderId, list);
    }
    return grouped;
  }, [queries]);

  const renameName = sheet?.kind === "rename" ? sheet.name : "";
  const renameBlank = renameName.trim().length === 0;

  return (
    <section className="queries-column" data-testid={QueriesAccessibility.column}>
      <div className="queries-column__header">
        <h2>{QueriesCopy.title}</h2>
        <button
          type="button"
          className="queries-column__new"
          data-testid={QueriesAccessibility.newQuery}
          aria-label={QueriesCopy.newQuery}
          onClick={onNewQuery}
        >
          +
        </button>
      </div>

      {queries.length === 0 ? (
        <p className="queries-column__empty">{QueriesCopy.empty}</p>
      ) : (
        <ul className="queries-column__list">
          {unfiled.map((query) => (
            <li key={query.id}>{queryButton(query, selectedQueryId, onSelectQuery)}</li>
          ))}
        </ul>
      )}
      {folders.map((folder) => (
        <div className="queries-column__folder" key={folder.id}>
          <h3 className="queries-column__folder-name">{folder.name}</h3>
          <ul className="queries-column__folder-queries">
            {(queriesByFolder.get(folder.id) ?? []).map((query) => (
              <li key={query.id}>{queryButton(query, selectedQueryId, onSelectQuery)}</li>
            ))}
          </ul>
        </div>
      ))}

      {selected !== null ? (
        <div className="queries-column__actions">
          <button
            type="button"
            onClick={() => setSheet({ kind: "rename", queryId: selected.id, name: selected.name })}
          >
            {QueriesCopy.rename}
          </button>
          <button type="button" onClick={() => setSheet({ kind: "delete", queryId: selected.id })}>
            {QueriesCopy.delete}
          </button>
          {folders.length > 0 ? (
            <button type="button" onClick={() => setSheet({ kind: "move", queryId: selected.id })}>
              {QueriesCopy.move}
            </button>
          ) : null}
          {selectedFolderId !== null ? (
            <button
              type="button"
              onClick={() => setSheet({ kind: "delete-folder", folderId: selectedFolderId })}
            >
              {QueriesCopy.deleteFolder}
            </button>
          ) : null}
        </div>
      ) : null}

      {sheet?.kind === "rename" ? (
        <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.rename}>
          <label htmlFor="queries-rename-name">
            {QueriesCopy.name}
            <input
              id="queries-rename-name"
              value={sheet.name}
              onChange={(event) =>
                setSheet({ kind: "rename", queryId: sheet.queryId, name: event.target.value })
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
              setSheet(null);
            }}
          >
            {QueriesCopy.save}
          </button>
          <button type="button" onClick={() => setSheet(null)}>
            {QueriesCopy.cancel}
          </button>
        </div>
      ) : null}

      {sheet?.kind === "delete" ? (
        <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.delete}>
          <button
            type="button"
            className="queries-column__sheet-primary"
            onClick={() => {
              onDeleteQuery(sheet.queryId);
              setSheet(null);
            }}
          >
            {QueriesCopy.confirmDelete}
          </button>
          <button type="button" onClick={() => setSheet(null)}>
            {QueriesCopy.cancel}
          </button>
        </div>
      ) : null}

      {sheet?.kind === "move" ? (
        <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.move}>
          {folders.map((folder) => (
            <button
              type="button"
              key={folder.id}
              onClick={() => {
                onMoveQuery(sheet.queryId, folder.id);
                setSheet(null);
              }}
            >
              {folder.name}
            </button>
          ))}
          <button type="button" onClick={() => setSheet(null)}>
            {QueriesCopy.cancel}
          </button>
        </div>
      ) : null}

      {sheet?.kind === "delete-folder" ? (
        <div className="queries-column__sheet" role="dialog" aria-label={QueriesCopy.deleteFolder}>
          <button
            type="button"
            onClick={() => {
              onDeleteFolder(sheet.folderId, false);
              setSheet(null);
            }}
          >
            {QueriesCopy.deleteFolderOnly}
          </button>
          <button
            type="button"
            onClick={() => {
              onDeleteFolder(sheet.folderId, true);
              setSheet(null);
            }}
          >
            {QueriesCopy.deleteFolderAndQueries}
          </button>
          <button type="button" onClick={() => setSheet(null)}>
            {QueriesCopy.cancel}
          </button>
        </div>
      ) : null}
    </section>
  );
}

function queryButton(
  query: SavedQueryDto,
  selectedQueryId: string | null,
  onSelectQuery: (id: string) => void,
): React.JSX.Element {
  const selected = query.id === selectedQueryId;
  return (
    <button
      type="button"
      className={
        selected ? "queries-column__query queries-column__query--selected" : "queries-column__query"
      }
      aria-pressed={selected}
      onClick={() => onSelectQuery(query.id)}
    >
      {query.name}
    </button>
  );
}
