/**
 * Connected-workspace shell: Queries sits beside the tab strip + canvas, and
 * results span the full main-column width below that row (flush to the
 * Connection sidebar). Extracted from `App.tsx` (T12) to keep that file a thin
 * composer of stores/hooks. `App.tsx` still owns the `app-main-column` wrapper
 * div, the `VisualQueryCanvas` construction (`canvas` prop passed in here), and
 * every handler — this component is presentational/wiring only.
 */
import type { ReactNode } from "react";
import { Group, Panel, Separator } from "react-resizable-panels";
import type {
  ColumnInfo,
  ConnectionProfileDto,
  ProfileId,
  QueryFolderDto,
  SavedQueryDto,
} from "../../ipc/contract";
import type { QueryResultsDateFormat } from "../../lib/date-format-setting";
import type {
  MutationToast as MutationToastData,
  TabResultGrid,
  TabRunStatus,
  TabState,
} from "../../stores/tabs-store";
import { QueriesColumn } from "../library/queries-column";
import { QueryResultsPane, type RowReloadRecovery } from "../results/query-results-pane";
import { MutationToast, type MutationToastTable } from "./mutation-toast";
import { TabBar } from "./tab-bar";
import { formatTabTitle } from "./tab-bar-copy";
import { WorkspaceSplit } from "./workspace-split";

export type AppWorkspaceProps = {
  workspaceReady: boolean;
  tabs: TabState[];
  activeTabId: string | null;
  pendingDeletedIds: Set<string>;
  profiles: ConnectionProfileDto[];
  profileId: ProfileId | null;
  libraryQueries: SavedQueryDto[];
  libraryFolders: QueryFolderDto[];
  savedQueryId: string | null;
  executingQueryId: string | null;
  schemaNames: string[];
  selectedSchema: string | null;
  schemaError: string | null;
  status: TabRunStatus;
  compact: TabResultGrid | null;
  raw: TabResultGrid | null;
  dateFormat: QueryResultsDateFormat;
  query: string;
  sourceTable?: { schema?: string; name: string };
  columnMetadata: ColumnInfo[];
  browse: boolean;
  hasNextPage: boolean;
  hasPrevPage: boolean;
  onNextPage: () => void;
  onPrevPage: () => void;
  onUpdateRow: (
    patch: Record<string, unknown | null>,
    primaryKey: Record<string, unknown>,
  ) => undefined | Promise<{ kind: "ok" } | RowReloadRecovery | undefined>;
  onDeleteRows: (
    primaryKeys: Record<string, unknown>[],
  ) => undefined | Promise<{ kind: "ok" } | RowReloadRecovery | undefined>;
  onSaveCsv: (csv: string) => void | Promise<void>;
  onRetryRowReload: () => void | Promise<void>;
  mutationToast: MutationToastData | null;
  canvas: React.ReactNode;
  onNewTab: () => void;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
  onSelectQuery: (id: string | null) => void;
  onNewQuery: () => void;
  onRenameQuery: (id: string, name: string) => void;
  onDeleteQuery: (id: string) => void;
  onMoveQuery: (id: string, folderId: string | null) => void;
  onDeleteFolder: (id: string, deleteQueries: boolean) => void;
  onLibraryRefresh: () => void | Promise<void>;
  onDuplicateQuery: (id: string) => void;
  onRenameFolder: (id: string, name: string) => void;
  onCreateFolder: (name: string) => Promise<{ id: string }> | { id: string };
  hasCachedResult: (id: string) => boolean;
  onSelectSchema: (schema: string | null) => void;
  onDismissSchemaError: () => void;
  onDismissMutationToast: () => void;
  onViewMutationTable: (table: MutationToastTable) => void;
};

export function AppWorkspace(props: AppWorkspaceProps): React.JSX.Element {
  const {
    workspaceReady,
    tabs,
    activeTabId,
    pendingDeletedIds,
    profiles,
    profileId,
    libraryQueries,
    libraryFolders,
    savedQueryId,
    executingQueryId,
    schemaNames,
    selectedSchema,
    schemaError,
    status,
    compact,
    raw,
    dateFormat,
    query,
    sourceTable,
    columnMetadata,
    browse,
    hasNextPage,
    hasPrevPage,
    onNextPage,
    onPrevPage,
    onUpdateRow,
    onDeleteRows,
    onSaveCsv,
    onRetryRowReload,
    mutationToast,
    canvas,
    onNewTab,
    onSwitchTab,
    onCloseTab,
    onSelectQuery,
    onNewQuery,
    onRenameQuery,
    onDeleteQuery,
    onMoveQuery,
    onDeleteFolder,
    onLibraryRefresh,
    onDuplicateQuery,
    onRenameFolder,
    onCreateFolder,
    hasCachedResult,
    onSelectSchema,
    onDismissSchemaError,
    onDismissMutationToast,
    onViewMutationTable,
  } = props;

  const toast = mutationToast;
  const tableName = toast?.tableName;

  const queriesPanel = (
    <Panel className="app-workspace-split__queries" defaultSize={220} minSize={160}>
      <QueriesColumn
        queries={libraryQueries}
        folders={libraryFolders}
        selectedQueryId={savedQueryId}
        onSelectQuery={onSelectQuery}
        onNewQuery={onNewQuery}
        onRenameQuery={onRenameQuery}
        onDeleteQuery={onDeleteQuery}
        onMoveQuery={onMoveQuery}
        onDeleteFolder={onDeleteFolder}
        onRefresh={onLibraryRefresh}
        onDuplicateQuery={onDuplicateQuery}
        onRenameFolder={onRenameFolder}
        onCreateFolder={onCreateFolder}
        hasCachedResult={hasCachedResult}
        executingQueryId={executingQueryId}
        schemas={schemaNames}
        selectedSchema={selectedSchema}
        onSelectSchema={onSelectSchema}
        schemaError={schemaError}
        onDismissSchemaError={onDismissSchemaError}
      />
    </Panel>
  );

  const queriesRow = (main: ReactNode) => (
    <Group orientation="horizontal" className="app-workspace-split">
      {queriesPanel}
      <Separator className="app-workspace-split__separator" />
      <Panel className="app-workspace-split__main" minSize={400}>
        {main}
      </Panel>
    </Group>
  );

  if (!workspaceReady) {
    return queriesRow(null);
  }

  return (
    <WorkspaceSplit
      canvas={queriesRow(
        <div className="app-workspace-main">
          <TabBar
            tabs={tabs.map((tab, index) => {
              const savedQueryName = libraryQueries.find(
                (query) => query.id === tab.savedQueryId,
              )?.name;
              const profile =
                profiles.find((candidate) => candidate.id === tab.connectionId) ??
                profiles.find((candidate) => candidate.id === profileId);
              const connectionDisplayName = profile ? profile.name?.trim() || profile.host : null;
              return {
                id: tab.id,
                title: formatTabTitle({
                  databaseName: tab.databaseName,
                  savedQueryName,
                  connectionDisplayName,
                  index: index + 1,
                }),
                isActive: tab.id === activeTabId,
                pendingClose: pendingDeletedIds.has(tab.id),
              };
            })}
            onNewTab={onNewTab}
            onSwitchTab={onSwitchTab}
            onCloseTab={onCloseTab}
          />
          {canvas}
        </div>,
      )}
      results={
        <div className="app-results-wrapper">
          {tableName ? (
            <MutationToast
              sql={toast.sql}
              title={toast.title}
              table={{
                schema: toast.tableSchema ?? undefined,
                name: tableName,
              }}
              onViewTable={onViewMutationTable}
              onDismiss={onDismissMutationToast}
            />
          ) : null}
          <QueryResultsPane
            status={status}
            compact={compact}
            raw={raw}
            dateFormat={dateFormat}
            query={query}
            sourceTable={sourceTable}
            columnMetadata={columnMetadata}
            browse={browse}
            hasNextPage={hasNextPage}
            hasPrevPage={hasPrevPage}
            onNextPage={onNextPage}
            onPrevPage={onPrevPage}
            onUpdateRow={onUpdateRow}
            onDeleteRows={onDeleteRows}
            onSaveCsv={onSaveCsv}
            onRetryRowReload={onRetryRowReload}
          />
        </div>
      }
    />
  );
}
