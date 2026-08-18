import { useCallback, useEffect, useImperativeHandle, useState } from "react";
import type {
  ColumnInfo,
  ConnectionId,
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  IpcError,
  ProfileId,
  TableRef,
} from "../../ipc/contract";
import { ConnectionStringParseError } from "../../lib/connection-string";
import { ConnectIcon, DisconnectIcon, SidebarIcon } from "../icons";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy, humanIpcErrorMessage } from "./connection-copy";
import { ConnectionCreatedDialog } from "./connection-created-dialog";
import { ConnectionDatabasePicker } from "./connection-database-picker";
import {
  ConnectionForm,
  type ConnectionFormValue,
  emptyConnectionFormValue,
  formValueFromProfile,
} from "./connection-form";
import { ConnectionFormSheet } from "./connection-form-sheet";
import { ConnectionPanelActions } from "./connection-panel-actions";
import { ConnectionProfileList } from "./connection-profile-list";
import { ConnectionStatusBanner, type ConnectionStatusPhase } from "./connection-status-banner";
import { ConnectionTablesList } from "./connection-tables-list";
import { useConnectionConfirmations } from "./use-connection-confirmations";
import { useConnectionStringMode } from "./use-connection-string-mode";
import "./connection.css";

const TEST_BANNER_MIN_MS = 150;
/** A passing Test is transient feedback; after this it falls back to session state. */
const TEST_SUCCESS_LINGER_MS = 4000;

async function waitRemaining(startedAt: number, minimumMs: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed >= minimumMs) return;
  await new Promise((resolve) => setTimeout(resolve, minimumMs - elapsed));
}

/** Imperative handle so the sidebar refresh can pull a fresh database list into the picker. */
export type ConnectionPanelHandle = {
  refreshDatabases: () => Promise<void>;
};

export interface ConnectionPanelProps {
  ref?: React.Ref<ConnectionPanelHandle>;
  ipc: DragonIpc;
  isConnected: boolean;
  activeProfileId?: ProfileId;
  formVisible: boolean;
  onFormVisibleChange: (next: boolean) => void;
  onProfilesLoaded: (count: number) => void;
  tables?: TableRef[];
  tablesLoading?: boolean;
  tablesErrorMessage?: string | null;
  onBrowse?: (table: TableRef) => void;
  columnsByTable?: Record<string, ColumnInfo[]>;
  executing?: boolean;
  onDrop?: (table: TableRef) => void | Promise<void>;
  onTruncate?: (table: TableRef) => void | Promise<void>;
  onGenerateDdl?: (table: TableRef) => unknown;
  onRefresh?: (table: TableRef) => void;
  onFetchAll?: (table: TableRef) => Promise<{ columns: string[]; rows: unknown[][] }>;
  onExpand?: (table: TableRef) => void;
  saveCsvFile?: DragonIpc["saveCsvFile"];
  saveTextFile?: DragonIpc["saveTextFile"];
  connectionId?: ConnectionId | null;
  databaseName?: string | null;
  /** Session switchDatabase — picker must not rewrite profile.database. */
  onSwitchDatabase?: (name: string) => Promise<void>;
  /** Clear session/tab database selection when the active catalog is dropped. */
  onClearDatabase?: () => Promise<void>;
  onCollapse?: () => void;
  missingDatabase?: boolean;
  /** Session connect via store (generation-guarded). Profile CRUD stays on ipc. */
  connectProfile: (id: ProfileId) => Promise<ConnectResult>;
  /** Session disconnect via store (orchestrator clear). Never raw ipc.disconnect for live session. */
  disconnectSession: () => Promise<void>;
  onConnected: (result: ConnectResult) => void;
  onDisconnected: () => void;
  onSwitchSuccess: (result: ConnectResult) => void;
  onSwitchFailure: (error: IpcError) => void;
}

export function ConnectionPanel(props: ConnectionPanelProps): React.JSX.Element {
  const {
    ref,
    ipc,
    isConnected,
    activeProfileId,
    formVisible,
    onFormVisibleChange,
    onProfilesLoaded,
    tables = [],
    tablesLoading = false,
    tablesErrorMessage = null,
    onBrowse,
    columnsByTable,
    executing,
    onDrop,
    onTruncate,
    onGenerateDdl,
    onRefresh,
    onFetchAll,
    onExpand,
    saveCsvFile,
    saveTextFile,
    connectProfile,
    disconnectSession,
    onConnected,
    onDisconnected,
    connectionId: connectionIdProp,
    databaseName: databaseNameProp,
    onSwitchDatabase,
    onClearDatabase,
    onCollapse,
    missingDatabase = false,
  } = props;

  const [profiles, setProfiles] = useState<ConnectionProfileDto[]>([]);
  const [selectedId, setSelectedId] = useState<ProfileId | null>(activeProfileId ?? null);
  const [form, setForm] = useState<ConnectionFormValue>(emptyConnectionFormValue);
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [bannerPhase, setBannerPhase] = useState<ConnectionStatusPhase>("idle");
  const [bannerMessage, setBannerMessage] = useState<string | null>(null);
  const [createdDialogOpen, setCreatedDialogOpen] = useState(false);
  const [databases, setDatabases] = useState<string[]>([]);
  const [pickerSelected, setPickerSelected] = useState<string | null>(databaseNameProp ?? null);
  const [liveConnectionId, setLiveConnectionId] = useState<ConnectionId | null>(
    connectionIdProp ?? null,
  );
  const [sessionClaimed, setSessionClaimed] = useState(isConnected);
  /** Profile id for the live session; prefers parent activeProfileId when claimed. */
  const [connectedProfileId, setConnectedProfileId] = useState<ProfileId | null>(
    isConnected ? (activeProfileId ?? null) : null,
  );
  const [busy, setBusy] = useState(false);
  const uri = useConnectionStringMode();
  const confirm = useConnectionConfirmations({
    ...props,
    profiles,
    selectedId,
    sessionClaimed,
    connectedProfileId,
    busy,
    resetUriMode: uri.resetUriMode,
    setSelectedId,
    setForm,
    setDirty,
    setSessionClaimed,
    setConnectedProfileId,
    setErrorMessage,
    setBusy,
    setProfiles,
  });

  const canConnect = selectedId !== null && !dirty && !sessionClaimed && !busy;

  async function refreshProfiles(): Promise<ConnectionProfileDto[]> {
    const list = await ipc.listProfiles();
    setProfiles(list);
    onProfilesLoaded(list.length);
    return list;
  }

  useEffect(() => {
    setSessionClaimed(isConnected);
    setConnectedProfileId(isConnected ? (activeProfileId ?? null) : null);
    if (!isConnected) {
      setLiveConnectionId(null);
      setDatabases([]);
    }
  }, [isConnected, activeProfileId]);

  useEffect(() => {
    if (connectionIdProp) setLiveConnectionId(connectionIdProp);
  }, [connectionIdProp]);

  useEffect(() => {
    if (bannerPhase !== "success") return;
    const timer = window.setTimeout(() => setBannerPhase("idle"), TEST_SUCCESS_LINGER_MS);
    return () => window.clearTimeout(timer);
  }, [bannerPhase]);

  useEffect(() => {
    if (databaseNameProp !== undefined) setPickerSelected(databaseNameProp);
  }, [databaseNameProp]);

  const refreshDatabases = useCallback(
    async (connectionId: ConnectionId): Promise<void> => {
      try {
        const list = await ipc.listDatabases(connectionId);
        setDatabases(list);
      } catch {
        setDatabases([]);
      }
    },
    [ipc],
  );

  useImperativeHandle(
    ref,
    () => ({
      refreshDatabases: async () => {
        if (liveConnectionId === null) return;
        await refreshDatabases(liveConnectionId);
      },
    }),
    [liveConnectionId, refreshDatabases],
  );

  useEffect(() => {
    if (!sessionClaimed || liveConnectionId === null) return;
    let cancelled = false;
    void ipc.listDatabases(liveConnectionId).then(
      (list) => {
        if (!cancelled) setDatabases(list);
      },
      () => {
        if (!cancelled) setDatabases([]);
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ipc, sessionClaimed, liveConnectionId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const list = await ipc.listProfiles();
        if (cancelled) return;
        setProfiles(list);
        const initialId = activeProfileId ?? null;
        if (initialId) {
          const found = list.find((p) => p.id === initialId);
          if (found) {
            setSelectedId(found.id);
            setForm(formValueFromProfile(found));
            setDirty(false);
          }
        }
      } catch (error) {
        if (cancelled) return;
        setErrorMessage(humanIpcErrorMessage(error));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [ipc, activeProfileId]);

  function updateForm(next: ConnectionFormValue): void {
    setForm(next);
    setDirty(true);
    setErrorMessage(null);
  }

  function startNewProfile(): void {
    setSelectedId(null);
    setForm(emptyConnectionFormValue());
    setDirty(false);
    setErrorMessage(null);
    confirm.clearPending();
    uri.resetUriMode();
    onFormVisibleChange(true);
  }

  function selectProfile(profile: ConnectionProfileDto): void {
    setErrorMessage(null);
    // Prefer parent activeProfileId so switch still confirms when App session lags behind panel.
    const liveId = sessionClaimed ? (activeProfileId ?? connectedProfileId ?? selectedId) : null;
    if (liveId !== null && profile.id !== liveId) {
      confirm.requestSwitch(profile.id);
      return;
    }
    setSelectedId(profile.id);
    setForm(formValueFromProfile(profile));
    setDirty(false);
    confirm.clearPending();
    uri.resetUriMode();
    onFormVisibleChange(true);
  }

  async function handleSave(): Promise<void> {
    const wasNew = selectedId === null;
    setBusy(true);
    setErrorMessage(null);
    try {
      const { profile, secrets } = uri.applyParseOnSave(form, selectedId);
      const saved = await ipc.saveProfile({
        id: selectedId ?? undefined,
        profile,
        secrets,
      });
      setSelectedId(saved.id);
      setForm(formValueFromProfile(saved));
      setDirty(false);
      await refreshProfiles();
      if (wasNew) setCreatedDialogOpen(true);
    } catch (error) {
      if (error instanceof ConnectionStringParseError) {
        setErrorMessage(error.message);
      } else {
        setErrorMessage(humanIpcErrorMessage(error));
      }
    } finally {
      setBusy(false);
    }
  }

  async function handleTest(): Promise<void> {
    const startedAt = Date.now();
    setBannerPhase(form.profile.sshEnabled ? "testingSSH" : "testing");
    setBannerMessage(null);
    try {
      await ipc.testConnection({
        host: form.profile.host,
        port: form.profile.port,
        username: form.profile.username,
        database: form.profile.database,
        sslMode: form.profile.sslMode,
        sshEnabled: form.profile.sshEnabled,
        sshHost: form.profile.sshHost,
        sshPort: form.profile.sshPort,
        sshUsername: form.profile.sshUsername,
        sshAuthMethod: form.profile.sshAuthMethod,
        password: form.secrets.password,
        sshPassword: form.secrets.sshPassword,
        sshPrivateKey: form.secrets.sshPrivateKey,
        sshPassphrase: form.secrets.sshPassphrase,
      });
      await waitRemaining(startedAt, TEST_BANNER_MIN_MS);
      setBannerPhase("success");
    } catch (error) {
      await waitRemaining(startedAt, TEST_BANNER_MIN_MS);
      setBannerPhase("error");
      setBannerMessage(humanIpcErrorMessage(error));
    }
  }

  async function handleSelectDatabase(name: string): Promise<void> {
    if (onSwitchDatabase) await onSwitchDatabase(name);
    setPickerSelected(name);
  }

  async function handleCreateDatabase(name: string): Promise<void> {
    await ipc.createDatabase(name);
    if (onSwitchDatabase) await onSwitchDatabase(name);
    setPickerSelected(name);
    if (liveConnectionId) await refreshDatabases(liveConnectionId);
  }

  async function handleDeleteDatabase(name: string): Promise<void> {
    await ipc.deleteDatabase(name);
    if (liveConnectionId) await refreshDatabases(liveConnectionId);
    if (pickerSelected === name) {
      setPickerSelected(null);
      if (onClearDatabase) await onClearDatabase();
    }
  }

  async function handleConnect(): Promise<void> {
    if (!canConnect || selectedId === null) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const result = await connectProfile(selectedId);
      setSessionClaimed(true);
      setConnectedProfileId(result.profileId);
      setLiveConnectionId(result.connectionId);
      setPickerSelected(result.database);
      setBannerPhase("idle");
      setBannerMessage(null);
      onConnected(result);
    } catch (error) {
      setSessionClaimed(false);
      setConnectedProfileId(null);
      setErrorMessage(humanIpcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleDisconnect(): Promise<void> {
    setBusy(true);
    setErrorMessage(null);
    try {
      await disconnectSession();
      setSessionClaimed(false);
      setConnectedProfileId(null);
      setLiveConnectionId(null);
      setDatabases([]);
      onDisconnected();
    } catch (error) {
      setErrorMessage(humanIpcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  const statusBanner = (
    <ConnectionStatusBanner
      phase={bannerPhase}
      isConnected={sessionClaimed}
      message={bannerMessage ?? undefined}
    />
  );
  const errorText =
    errorMessage !== null ? (
      <p className="connection-panel__status" role="status">
        {errorMessage}
      </p>
    ) : null;

  return (
    <section className="connection-panel" aria-label={ConnectionCopy.panelTitle}>
      <div className="connection-panel__header">
        <h2>{ConnectionCopy.panelTitle}</h2>
        <div className="connection-panel__header-actions">
          {/* Ending the session belongs to the live connection in the sidebar,
              not to the edit sheet — the sheet can be closed while connected. */}
          {sessionClaimed ? (
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn--danger"
              aria-label={ConnectionCopy.disconnect}
              title={ConnectionCopy.disconnect}
              disabled={busy}
              onClick={() => void handleDisconnect()}
            >
              <DisconnectIcon />
            </button>
          ) : null}
          {/* Reconnecting the selected profile without reopening the sheet.
              Hidden while the sheet is open — its footer owns Connect there,
              so exactly one Connect control exists at any time. */}
          {!sessionClaimed && !formVisible && selectedId !== null ? (
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn--accent"
              aria-label={ConnectionCopy.connect}
              title={ConnectionCopy.connect}
              disabled={!canConnect}
              onClick={() => void handleConnect()}
            >
              <ConnectIcon />
            </button>
          ) : null}
          {/* The form sheet is fixed-position and lives inside this panel, so it
              would keep floating over a collapsed shell with no column left to
              return to. The scrim already reads as "not now"; disabling makes
              that true instead of stranding the draft. */}
          {onCollapse ? (
            <button
              type="button"
              className="ui-icon-btn"
              data-testid={ConnectionAccessibility.collapseConnection}
              aria-label={ConnectionCopy.collapseConnection}
              title={ConnectionCopy.collapseConnection}
              disabled={formVisible}
              onClick={onCollapse}
            >
              <SidebarIcon />
            </button>
          ) : null}
        </div>
      </div>

      {formVisible ? null : (
        <>
          {statusBanner}
          {errorText}
        </>
      )}

      <ConnectionProfileList
        profiles={profiles}
        formVisible={formVisible}
        onSelect={selectProfile}
        onNewProfile={startNewProfile}
        activeId={sessionClaimed ? (connectedProfileId ?? selectedId) : selectedId}
        onRequestDelete={(profile) => confirm.requestDelete(profile.id)}
      />

      {sessionClaimed && selectedId !== null ? (
        <ConnectionDatabasePicker
          isConnected={sessionClaimed}
          databases={databases}
          selected={pickerSelected}
          onSelect={(name) => void handleSelectDatabase(name)}
          profileDatabase={form.profile.database}
          missingFromList={
            missingDatabase || (pickerSelected !== null && !databases.includes(pickerSelected))
          }
          onCreateDatabase={handleCreateDatabase}
          onDeleteDatabase={handleDeleteDatabase}
        />
      ) : null}

      {sessionClaimed ? (
        <ConnectionTablesList
          tables={tables}
          tablesLoading={tablesLoading}
          tablesErrorMessage={tablesErrorMessage}
          onBrowse={onBrowse}
          columnsByTable={columnsByTable}
          executing={executing}
          onDrop={onDrop}
          onTruncate={onTruncate}
          onGenerateDdl={onGenerateDdl}
          onRefresh={onRefresh}
          onFetchAll={onFetchAll}
          onExpand={onExpand}
          saveCsvFile={saveCsvFile}
          saveTextFile={saveTextFile}
        />
      ) : null}

      {formVisible ? (
        <ConnectionFormSheet
          title={selectedId === null ? ConnectionCopy.formTitleNew : ConnectionCopy.formTitleEdit}
          onCancel={() => onFormVisibleChange(false)}
          escapeBlocked={createdDialogOpen || confirm.hasPending}
          notice={
            <>
              {statusBanner}
              {errorText}
            </>
          }
          footer={
            <ConnectionPanelActions
              busy={busy}
              canConnect={canConnect}
              sessionClaimed={sessionClaimed}
              selectedId={selectedId}
              hideConnect={createdDialogOpen}
              onSave={() => void handleSave()}
              onConnect={() => void handleConnect()}
              onRequestDelete={() => confirm.requestDelete(selectedId)}
              onCancel={() => onFormVisibleChange(false)}
            />
          }
        >
          <ConnectionForm
            value={form}
            onChange={updateForm}
            onTest={() => void handleTest()}
            connectionStringMode={uri.connectionStringMode}
            onConnectionStringModeChange={(next) => {
              uri.setConnectionStringMode(next);
              setErrorMessage(null);
            }}
            connectionStringValue={uri.uriValue(selectedId, form)}
            onConnectionStringChange={(next) => {
              uri.setConnectionStringDraft(next);
              setDirty(true);
              setErrorMessage(null);
            }}
            connectionStringReadOnly={selectedId !== null}
            onCopyConnectionString={() => void uri.copy(selectedId, form)}
          />

          {!canConnect && !sessionClaimed && selectedId === null ? (
            <p className="connection-panel__hint">{ConnectionCopy.connectHint}</p>
          ) : null}
        </ConnectionFormSheet>
      ) : null}

      <ConnectionCreatedDialog
        open={createdDialogOpen}
        onConnectNow={() => {
          setCreatedDialogOpen(false);
          void handleConnect();
        }}
        onNotNow={() => setCreatedDialogOpen(false)}
      />

      {confirm.dialogs}
    </section>
  );
}
