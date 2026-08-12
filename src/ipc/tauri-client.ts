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
  SaveCsvFileResult,
  SavedQueryDto,
  SaveProfileInput,
  TableRef,
  TabStateDto,
  UpdateRowInput,
} from "./contract";

/** Phase A stub — real invoke maps land in Phase B. */
function phaseBStub(method: string): Promise<never> {
  return Promise.reject(new Error(`SP-3 Phase B: ${method} not wired`));
}

const KNOWN_KINDS = new Set(["connection", "auth", "syntax", "permission", "unknown"]);

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

async function invokeCommand<T>(cmd: string, args?: Record<string, unknown>): Promise<T> {
  try {
    return args === undefined ? await invoke<T>(cmd) : await invoke<T>(cmd, args);
  } catch (err) {
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

    // SP-3 Phase A stubs — empty reads; mutating methods throw until Phase B.
    // Do NOT call invoke for these yet.
    listSavedQueries(): Promise<SavedQueryDto[]> {
      return Promise.resolve([]);
    },
    getSavedQuery(_id: string): Promise<SavedQueryDto | null> {
      return Promise.resolve(null);
    },
    saveSavedQuery(_query: SavedQueryDto): Promise<SavedQueryDto> {
      return phaseBStub("saveSavedQuery");
    },
    deleteSavedQueries(_ids: string[]): Promise<void> {
      return phaseBStub("deleteSavedQueries");
    },
    duplicateSavedQuery(_id: string): Promise<SavedQueryDto> {
      return phaseBStub("duplicateSavedQuery");
    },
    moveSavedQuery(_id: string, _folderId: string | null): Promise<void> {
      return phaseBStub("moveSavedQuery");
    },
    listQueryFolders(): Promise<QueryFolderDto[]> {
      return Promise.resolve([]);
    },
    createQueryFolder(_name: string): Promise<QueryFolderDto> {
      return phaseBStub("createQueryFolder");
    },
    renameQueryFolder(_id: string, _name: string): Promise<void> {
      return phaseBStub("renameQueryFolder");
    },
    deleteFolder(_id: string, _deleteQueries: boolean): Promise<void> {
      return phaseBStub("deleteFolder");
    },
    listTabStates(): Promise<TabStateDto[]> {
      return Promise.resolve([]);
    },
    saveTabState(
      _input: TabStateDto,
      _opts?: { includeCachedResults?: boolean },
    ): Promise<void> {
      return phaseBStub("saveTabState");
    },
    deleteTabState(_id: string): Promise<void> {
      return phaseBStub("deleteTabState");
    },
    listHistory(_opts: HistoryListOptions): Promise<HistoryDto[]> {
      return Promise.resolve([]);
    },
    deleteHistory(_id: string): Promise<void> {
      return phaseBStub("deleteHistory");
    },
    clearHistory(_profileId: ProfileId): Promise<void> {
      return phaseBStub("clearHistory");
    },
    saveCsvFile(_csvText: string, _defaultPath?: string): Promise<SaveCsvFileResult> {
      return Promise.resolve({ canceled: true });
    },
    updateRow(_input: UpdateRowInput): Promise<void> {
      return phaseBStub("updateRow");
    },
    deleteRows(_input: DeleteRowsInput): Promise<void> {
      return phaseBStub("deleteRows");
    },
  };
}
