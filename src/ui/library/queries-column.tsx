import { useEffect, useMemo, useState } from "react";
import type { QueryFolderDto, SavedQueryDto } from "../../ipc/contract";
import { QueriesAccessibility } from "./queries-accessibility";
import { QueriesColumnSheets, type QueriesSheet } from "./queries-column-sheets";
import { QueriesColumnToolbar } from "./queries-column-toolbar";
import { QueriesCopy } from "./queries-copy";
import { QueriesFolderRow } from "./queries-folder-row";
import { QueriesQueryRow } from "./queries-query-row";
import { type QuerySortKey, sortQueries } from "./queries-sort";
import "./queries.css";

export type { QuerySortKey };

export type QueriesColumnProps = {
  queries: SavedQueryDto[];
  folders: QueryFolderDto[];
  selectedQueryId: string | null;
  onSelectQuery: (id: string | null) => void;
  onNewQuery: () => void;
  onRenameQuery: (id: string, name: string) => void;
  onDeleteQuery: (id: string) => void;
  onMoveQuery: (id: string, folderId: string | null) => void;
  onDeleteFolder: (id: string, deleteQueries: boolean) => void;
  onRefresh?: () => void | Promise<void>;
  onDuplicateQuery?: (id: string) => void;
  onRenameFolder?: (id: string, name: string) => void;
  onCreateFolder?: (name: string) => Promise<{ id: string }> | { id: string };
  hasCachedResult?: (id: string) => boolean;
  executingQueryId?: string | null;
  schemas?: string[];
  selectedSchema?: string | null;
  onSelectSchema?: (schema: string | null) => void;
  schemaError?: string | null;
  onDismissSchemaError?: () => void;
};

const REFRESH_MIN_MS = 450;

/**
 * True when the Delete keydown target is a text-editing surface — a plain
 * input/textarea (the jsdom test fallback for the hatch editor) or a
 * contenteditable element such as CodeMirror's `.cm-content` (the real
 * runtime hatch editor). Those must handle Delete themselves; only bare
 * clicks on the Queries list should open the delete-query sheet.
 */
function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  if (target.isContentEditable) return true;
  if (target.closest('[contenteditable="true"], .cm-content, .cm-editor') !== null) return true;
  return false;
}

function isQueriesColumnTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  return target.closest(`[data-testid="${QueriesAccessibility.column}"]`) !== null;
}

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
    onRefresh,
    onDuplicateQuery,
    onRenameFolder,
    onCreateFolder,
    hasCachedResult,
    executingQueryId,
    schemas,
    selectedSchema,
    onSelectSchema,
    schemaError,
    onDismissSchemaError,
  } = props;
  const [sheet, setSheet] = useState<QueriesSheet | null>(null);
  const [filter, setFilter] = useState("");
  const [sort, setSort] = useState<QuerySortKey>("name-asc");
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set());
  const [pickedIds, setPickedIds] = useState<ReadonlySet<string>>(() => new Set());
  const [refreshing, setRefreshing] = useState(false);

  const selected = queries.find((query) => query.id === selectedQueryId) ?? null;
  const needle = filter.trim().toLowerCase();
  const visible = useMemo(() => {
    const matched =
      needle.length === 0
        ? queries
        : queries.filter((query) => query.name.toLowerCase().includes(needle));
    return sortQueries(matched, sort);
  }, [queries, needle, sort]);
  const unfiled = useMemo(() => visible.filter((query) => query.folderId === null), [visible]);
  const queriesByFolder = useMemo(() => {
    const grouped = new Map<string, SavedQueryDto[]>();
    for (const query of visible) {
      if (query.folderId === null) continue;
      const list = grouped.get(query.folderId) ?? [];
      list.push(query);
      grouped.set(query.folderId, list);
    }
    return grouped;
  }, [visible]);
  const countsByFolder = useMemo(() => {
    const counts = new Map<string, number>();
    for (const query of queries) {
      if (query.folderId === null) continue;
      counts.set(query.folderId, (counts.get(query.folderId) ?? 0) + 1);
    }
    return counts;
  }, [queries]);

  const noMatches = needle.length > 0 && visible.length === 0;
  const renameName =
    sheet?.kind === "rename" || sheet?.kind === "rename-folder" || sheet?.kind === "new-folder"
      ? sheet.name
      : "";
  const renameBlank = renameName.trim().length === 0;
  const sheetOpen = sheet !== null;

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key !== "Delete") return;
      if (!isQueriesColumnTarget(event.target)) return;
      if (isEditableTarget(event.target)) return;
      const ids =
        pickedIds.size > 0 ? [...pickedIds] : selectedQueryId !== null ? [selectedQueryId] : [];
      if (ids.length === 0) return;
      event.preventDefault();
      setSheet({ kind: "delete", queryIds: ids });
    }
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [pickedIds, selectedQueryId]);

  async function handleRefresh(): Promise<void> {
    if (!onRefresh || refreshing) return;
    setRefreshing(true);
    try {
      await Promise.all([
        Promise.resolve(onRefresh()),
        new Promise<void>((resolve) => {
          window.setTimeout(resolve, REFRESH_MIN_MS);
        }),
      ]);
    } finally {
      setRefreshing(false);
    }
  }

  function toggleCollapsed(folderId: string): void {
    setCollapsed((current) => {
      const next = new Set(current);
      if (next.has(folderId)) next.delete(folderId);
      else next.add(folderId);
      return next;
    });
  }

  function selectQuery(event: React.MouseEvent, queryId: string): void {
    if (event.metaKey || event.ctrlKey) {
      setPickedIds((current) => {
        const next = new Set(current);
        if (next.has(queryId)) next.delete(queryId);
        else next.add(queryId);
        return next;
      });
      return;
    }
    setPickedIds(new Set());
    onSelectQuery(queryId);
  }

  function renderQuery(query: SavedQueryDto): React.JSX.Element {
    return (
      <QueriesQueryRow
        query={query}
        selected={query.id === selectedQueryId}
        picked={pickedIds.has(query.id)}
        cached={hasCachedResult?.(query.id) === true}
        executing={executingQueryId === query.id}
        onClick={selectQuery}
      />
    );
  }

  return (
    <section className="queries-column" data-testid={QueriesAccessibility.column}>
      <div
        className="queries-column__body"
        inert={sheetOpen ? true : undefined}
        aria-hidden={sheetOpen ? true : undefined}
      >
        <QueriesColumnToolbar
          filter={filter}
          sort={sort}
          onFilterChange={setFilter}
          onSortChange={setSort}
          onNewQuery={onNewQuery}
          onRefresh={onRefresh ? () => void handleRefresh() : undefined}
          schemas={schemas}
          selectedSchema={selectedSchema}
          onSelectSchema={onSelectSchema}
          schemaError={schemaError}
          onDismissSchemaError={onDismissSchemaError}
        />

        {refreshing ? (
          <div
            className="queries-column__refresh-overlay"
            data-testid={QueriesAccessibility.refreshOverlay}
          >
            {QueriesCopy.refreshing}
          </div>
        ) : null}

        {noMatches ? (
          <p className="queries-column__empty">{QueriesCopy.noMatchingQueries}</p>
        ) : queries.length === 0 ? (
          <p className="queries-column__empty">{QueriesCopy.empty}</p>
        ) : (
          <ul className="queries-column__list">
            {unfiled.map((query) => (
              <li key={query.id}>{renderQuery(query)}</li>
            ))}
          </ul>
        )}
        {folders.map((folder) => (
          <QueriesFolderRow
            key={folder.id}
            folder={folder}
            expanded={!collapsed.has(folder.id)}
            onToggleExpanded={() => toggleCollapsed(folder.id)}
            onDeleteFolder={() =>
              setSheet({
                kind: "delete-folder",
                folderId: folder.id,
                empty: (countsByFolder.get(folder.id) ?? 0) === 0,
              })
            }
            onRenameFolder={
              onRenameFolder
                ? () => setSheet({ kind: "rename-folder", folderId: folder.id, name: folder.name })
                : undefined
            }
          >
            {(queriesByFolder.get(folder.id) ?? []).map((query) => (
              <li key={query.id}>{renderQuery(query)}</li>
            ))}
          </QueriesFolderRow>
        ))}

        {selected !== null ? (
          <div className="queries-column__actions">
            <button type="button" onClick={() => onSelectQuery(null)}>
              {QueriesCopy.deselect}
            </button>
            <button
              type="button"
              onClick={() =>
                setSheet({ kind: "rename", queryId: selected.id, name: selected.name })
              }
            >
              {QueriesCopy.rename}
            </button>
            <button
              type="button"
              onClick={() => setSheet({ kind: "delete", queryIds: [selected.id] })}
            >
              {QueriesCopy.delete}
            </button>
            {onDuplicateQuery ? (
              <button type="button" onClick={() => onDuplicateQuery(selected.id)}>
                {QueriesCopy.duplicate}
              </button>
            ) : null}
            <button type="button" onClick={() => setSheet({ kind: "move", queryId: selected.id })}>
              {QueriesCopy.move}
            </button>
          </div>
        ) : null}
      </div>

      {sheet ? (
        <QueriesColumnSheets
          sheet={sheet}
          folders={folders}
          renameBlank={renameBlank}
          onSheetChange={setSheet}
          onRenameQuery={onRenameQuery}
          onDeleteQuery={onDeleteQuery}
          onMoveQuery={onMoveQuery}
          onDeleteFolder={onDeleteFolder}
          onRenameFolder={onRenameFolder}
          onCreateFolder={onCreateFolder}
          onDeleted={() => setPickedIds(new Set())}
        />
      ) : null}
    </section>
  );
}
