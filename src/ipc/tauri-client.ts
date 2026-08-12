import { invoke } from "@tauri-apps/api/core";
import type { ExecutableSQL } from "../core";
import type {
  ColumnInfo,
  ConnectionId,
  ConnectionProfileDto,
  ConnectResult,
  DeleteRowsInput,
  DragonIpc,
  HistoryDto,
  HistoryListOptions,
  IpcError,
  ProfileId,
  QueryFolderDto,
  QueryResult,
  RowOperationError,
  RowOperationErrorKind,
  SaveCsvFileResult,
  SavedQueryDto,
  SaveProfileInput,
  TableRef,
  TabStateDto,
  UpdateRowInput,
} from "./contract";

const KNOWN_KINDS = new Set(["connection", "auth", "syntax", "permission", "unknown"]);

const ROW_OP_KINDS = new Set<RowOperationErrorKind>([
  "noPrimaryKey",
  "noTableSelected",
  "noRowsSelected",
  "metadataFetchFailed",
  "updateFailed",
  "deleteFailed",
]);

function normalizeIpcError(payload: unknown): IpcError {
  if (payload !== null && typeof payload === "object") {
    const obj = payload as Record<string, unknown>;
    const message =
      typeof obj.message === "string" ? obj.message : String(obj.message ?? "Unknown error");
    const kindRaw = obj.kind;

    if (typeof kindRaw === "string" && KNOWN_KINDS.has(kindRaw)) {
      if (kindRaw === "syntax") {
        const position = typeof obj.position === "number" ? obj.position : null;
        return { kind: "syntax", message, position };
      }
      return { kind: kindRaw as Exclude<IpcError["kind"], "syntax">, message };
    }

    return { kind: "unknown", message };
  }

  if (typeof payload === "string") {
    return { kind: "unknown", message: payload };
  }

  return { kind: "unknown", message: String(payload ?? "Unknown error") };
}

function isRowOperationError(payload: unknown): payload is RowOperationError {
  if (payload === null || typeof payload !== "object") {
    return false;
  }
  const obj = payload as Record<string, unknown>;
  return typeof obj.kind === "string" && ROW_OP_KINDS.has(obj.kind as RowOperationErrorKind);
}

async function invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return args === undefined ? await invoke<T>(cmd) : await invoke<T>(cmd, args);
  } catch (err) {
    throw normalizeIpcError(err);
  }
}

/**
 * Row-ops invoke path — preserves `RowOperationError` kinds.
 * Do NOT route through `normalizeIpcError` (which collapses unknown kinds to `"unknown"`).
 */
async function invokeRowOp(cmd: string, args: Record<string, unknown>): Promise<void> {
  try {
    await invoke(cmd, args);
  } catch (err) {
    if (isRowOperationError(err)) {
      throw err;
    }
    throw normalizeIpcError(err);
  }
}

/** Production DragonIpc backed by Tauri `invoke` — no mock fallback. */
export function createTauriDragonIpc(): DragonIpc {
  return {
    listProfiles(): Promise<ConnectionProfileDto[]> {
      return invokeCommand("list_profiles");
    },

    getProfile(id: ProfileId): Promise<ConnectionProfileDto | null> {
      return invokeCommand("get_profile", { id });
    },

    saveProfile(input: SaveProfileInput): Promise<ConnectionProfileDto> {
      return invokeCommand("save_profile", {
        id: input.id,
        profile: input.profile,
        secrets: input.secrets,
      });
    },

    deleteProfile(id: ProfileId): Promise<void> {
      return invokeCommand("delete_profile", { id });
    },

    connectProfile(id: ProfileId): Promise<ConnectResult> {
      return invokeCommand("connect_profile", { id });
    },

    disconnect(): Promise<void> {
      return invokeCommand("disconnect");
    },

    listTables(c: ConnectionId): Promise<TableRef[]> {
      return invokeCommand("list_tables", { connectionId: c });
    },

    listColumns(c: ConnectionId, table: TableRef): Promise<ColumnInfo[]> {
      return invokeCommand("list_columns", { connectionId: c, table });
    },

    runQuery(c: ConnectionId, sql: ExecutableSQL): Promise<QueryResult> {
      return invokeCommand("run_query", { connectionId: c, sql });
    },

    // SP-3 library — real Tauri invoke maps (Phase B).
    listSavedQueries(): Promise<SavedQueryDto[]> {
      return invokeCommand("list_saved_queries");
    },
    getSavedQuery(id: string): Promise<SavedQueryDto | null> {
      return invokeCommand("get_saved_query", { id });
    },
    saveSavedQuery(query: SavedQueryDto): Promise<SavedQueryDto> {
      return invokeCommand("save_saved_query", { query });
    },
    deleteSavedQueries(ids: string[]): Promise<void> {
      return invokeCommand("delete_saved_queries", { ids });
    },
    duplicateSavedQuery(id: string): Promise<SavedQueryDto> {
      return invokeCommand("duplicate_saved_query", { id });
    },
    moveSavedQuery(id: string, folderId: string | null): Promise<void> {
      return invokeCommand("move_saved_query", { id, folderId });
    },
    listQueryFolders(): Promise<QueryFolderDto[]> {
      return invokeCommand("list_folders");
    },
    createQueryFolder(name: string): Promise<QueryFolderDto> {
      return invokeCommand("create_folder", { name });
    },
    renameQueryFolder(id: string, name: string): Promise<void> {
      return invokeCommand("rename_folder", { id, name });
    },
    deleteFolder(id: string, deleteQueries: boolean): Promise<void> {
      return invokeCommand("delete_folder", { id, deleteQueries });
    },
    // SP-3 tabs — real Tauri invoke maps (Phase B).
    listTabStates(): Promise<TabStateDto[]> {
      return invokeCommand("list_tab_states");
    },
    saveTabState(input: TabStateDto, opts?: { includeCachedResults?: boolean }): Promise<void> {
      return invokeCommand("save_tab_state", {
        input,
        includeCachedResults: opts?.includeCachedResults ?? false,
      });
    },
    deleteTabState(id: string): Promise<void> {
      return invokeCommand("delete_tab_state", { id });
    },
    // SP-3 history — real Tauri invoke maps (Phase B).
    listHistory(opts: HistoryListOptions): Promise<HistoryDto[]> {
      return invokeCommand("list_history", { ...opts });
    },
    deleteHistory(id: string): Promise<void> {
      return invokeCommand("delete_history", { id });
    },
    clearHistory(profileId: ProfileId): Promise<void> {
      return invokeCommand("clear_history", { profileId });
    },
    // SP-3 CSV save-file — real invoke (cancel returns `{ canceled: true }`).
    saveCsvFile(csvText: string, defaultPath?: string): Promise<SaveCsvFileResult> {
      return invokeCommand("save_csv_file", { csvText, defaultPath });
    },
    // SP-3 row ops — invokeRowOp preserves RowOperationError kinds (not IpcError).
    updateRow(input: UpdateRowInput): Promise<void> {
      return invokeRowOp("update_row", {
        connectionId: input.connectionId,
        table: input.table,
        primaryKey: input.primaryKey,
        patch: input.patch,
      });
    },
    deleteRows(input: DeleteRowsInput): Promise<void> {
      return invokeRowOp("delete_rows", {
        connectionId: input.connectionId,
        table: input.table,
        primaryKeys: input.primaryKeys,
      });
    },
  };
}
