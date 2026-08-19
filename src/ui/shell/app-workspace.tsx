/**
 * Connected-workspace shell: tab strip + canvas above results spanning the full
 * main-column width (flush to the sidebar). Extracted from `App.tsx` (T12) to
 * keep that file a thin composer of stores/hooks. `App.tsx` still owns the
 * `app-main-column` wrapper div, the `VisualQueryCanvas` construction (`canvas`
 * prop passed in here), and every handler — this component is presentational/wiring only.
 */
import type { ReactNode } from "react";
import type {
  ColumnInfo,
  ConnectionProfileDto,
  ProfileId,
  SavedQueryDto,
} from "../../ipc/contract";
import type { QueryResultsDateFormat } from "../../lib/date-format-setting";
import type {
  MutationToast as MutationToastData,
  TabResultGrid,
  TabRunStatus,
  TabState,
} from "../../stores/tabs-store";
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
  canvas: ReactNode;
  onNewTab: () => void;
  onSwitchTab: (id: string) => void;
  onCloseTab: (id: string) => void;
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
    onDismissMutationToast,
    onViewMutationTable,
  } = props;

  const toast = mutationToast;
  const tableName = toast?.tableName;

  if (!workspaceReady) {
    return <div className="app-workspace-main" />;
  }

  return (
    <WorkspaceSplit
      canvas={
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
        </div>
      }
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
