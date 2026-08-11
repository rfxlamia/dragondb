import { useEffect, useRef, useState } from "react";
import type { ExecutableSQL, TableReference } from "./core";
import type { ConnectionId, ConnectResult, DragonIpc, IpcError, ProfileId } from "./ipc/contract";
import { coreToTableRef, tableRefToCore } from "./ipc/table-ref";
import { createTauriDragonIpc } from "./ipc/tauri-client";
import { ConnectionPanel } from "./ui/connection/connection-panel";
import { VisualQueryCanvas } from "./ui/visual-query/canvas";
import { VisualQueryCopy } from "./ui/visual-query/copy";
import "./App.css";

export type AppProps = { ipc?: DragonIpc };

function ensureDefaultIpc(ref: { current: DragonIpc | null }): DragonIpc {
  const existing = ref.current;
  if (existing !== null) return existing;
  const created = createTauriDragonIpc();
  ref.current = created;
  return created;
}

export default function App({ ipc: ipcProp }: AppProps = {}) {
  // Lazy default: never call createTauriDragonIpc at module scope or when ipc is injected.
  const defaultIpcRef = useRef<DragonIpc | null>(null);
  const ipc = ipcProp ?? ensureDefaultIpc(defaultIpcRef);

  const [isConnected, setIsConnected] = useState(false);
  const [connectionId, setConnectionId] = useState<ConnectionId | null>(null);
  const [profileId, setProfileId] = useState<ProfileId | null>(null);
  const [canvasEpoch, setCanvasEpoch] = useState(0);

  const [tables, setTables] = useState<TableReference[]>([]);
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [metadataErrorMessage, setMetadataErrorMessage] = useState<string | null>(null);

  const columnGeneration = useRef(0);
  const mounted = useRef(true);
  /** Live connection id for in-flight column loads (avoids stale closure). */
  const connectionIdRef = useRef<ConnectionId | null>(null);
  connectionIdRef.current = connectionId;

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      columnGeneration.current += 1;
    };
  }, []);

  function loadTables(cid: ConnectionId): void {
    void ipc.listTables(cid).then(
      (rows) => {
        if (!mounted.current) return;
        setTables(rows.map(tableRefToCore));
      },
      () => {
        if (!mounted.current) return;
        setTables([]);
        setMetadataErrorMessage(VisualQueryCopy.tablesLoadError);
      },
    );
  }

  function clearSession(): void {
    setIsConnected(false);
    setConnectionId(null);
    setProfileId(null);
  }

  function applyConnected(result: ConnectResult): void {
    setIsConnected(true);
    setConnectionId(result.connectionId);
    setProfileId(result.profileId);
    setColumnNames([]);
    setMetadataErrorMessage(null);
    loadTables(result.connectionId);
  }

  function handleConnected(result: ConnectResult): void {
    applyConnected(result);
  }

  function handleDisconnected(): void {
    // Lock canvas; preserve cards by not remounting (no canvasEpoch bump).
    clearSession();
  }

  function handleSwitchSuccess(result: ConnectResult): void {
    setCanvasEpoch((epoch) => epoch + 1);
    setTables([]);
    setColumnNames([]);
    setMetadataErrorMessage(null);
    applyConnected(result);
  }

  function handleSwitchFailure(_error: IpcError): void {
    // Panel already shows errorMessage; lock snapshot without remounting.
    clearSession();
  }

  function handleCommittedFromChange(table: TableReference | null): void {
    const generation = ++columnGeneration.current;
    setColumnNames([]);
    setMetadataErrorMessage(null);
    if (table === null) return;

    const liveId = connectionIdRef.current;
    if (liveId === null) return;

    void ipc.listColumns(liveId, coreToTableRef(table)).then(
      (rows) => {
        if (!mounted.current || generation !== columnGeneration.current) return;
        setColumnNames(rows.map((column) => column.name));
      },
      () => {
        if (!mounted.current || generation !== columnGeneration.current) return;
        setColumnNames([]);
        setMetadataErrorMessage(VisualQueryCopy.columnsLoadError);
      },
    );
  }

  const onRunQuery =
    isConnected && connectionId !== null
      ? (sql: ExecutableSQL) => ipc.runQuery(connectionId, sql)
      : undefined;

  return (
    <main className="app-shell">
      <ConnectionPanel
        ipc={ipc}
        isConnected={isConnected}
        activeProfileId={profileId ?? undefined}
        onConnected={handleConnected}
        onDisconnected={handleDisconnected}
        onSwitchSuccess={handleSwitchSuccess}
        onSwitchFailure={handleSwitchFailure}
      />
      <VisualQueryCanvas
        key={canvasEpoch}
        tables={tables}
        columnNames={columnNames}
        metadataErrorMessage={metadataErrorMessage}
        isConnected={isConnected}
        onRunQuery={onRunQuery}
        onCommittedFromChange={handleCommittedFromChange}
      />
    </main>
  );
}
