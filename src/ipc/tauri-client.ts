import { invoke } from "@tauri-apps/api/core";
import type { ExecutableSQL } from "../core";
import type {
  ColumnInfo,
  ConnectionId,
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  IpcError,
  ProfileId,
  QueryResult,
  SaveProfileInput,
  TableRef,
} from "./contract";

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
  };
}
