import { useEffect, useState } from "react";
import type {
  ConnectionId,
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  IpcError,
  ProfileId,
  TableRef,
} from "../../ipc/contract";
import { ConnectionStringParseError } from "../../lib/connection-string";
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
import { ConnectionPanelActions } from "./connection-panel-actions";
import { ConnectionProfileList } from "./connection-profile-list";
import { ConnectionStatusBanner, type ConnectionStatusPhase } from "./connection-status-banner";
import { ConnectionTablesList } from "./connection-tables-list";
import { useConnectionConfirmations } from "./use-connection-confirmations";
import { useConnectionStringMode } from "./use-connection-string-mode";
import "./connection.css";

const TEST_BANNER_MIN_MS = 150;

async function waitRemaining(startedAt: number, minimumMs: number): Promise<void> {
  const elapsed = Date.now() - startedAt;
  if (elapsed >= minimumMs) return;
  await new Promise((resolve) => setTimeout(resolve, minimumMs - elapsed));
}

export interface ConnectionPanelProps {
  ipc: DragonIpc;
  isConnected: boolean;
  activeProfileId?: ProfileId;
  formVisible: boolean;
  onFormVisibleChange: (next: boolean) => void;
  onProfilesLoaded: (count: number) => void;
  tables?: TableRef[];
  tablesLoading?: boolean;
  tablesErrorMessage?: string | null;
  connectionId?: ConnectionId | null;
  databaseName?: string | null;
  /** Session switchDatabase — picker must not rewrite profile.database. */
  onSwitchDatabase?: (name: string) => Promise<void>;
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
    ipc,
    isConnected,
    activeProfileId,
    formVisible,
    onFormVisibleChange,
    onProfilesLoaded,
    tables = [],
    tablesLoading = false,
    tablesErrorMessage = null,
    connectProfile,
    disconnectSession,
    onConnected,
    onDisconnected,
    connectionId: connectionIdProp,
    databaseName: databaseNameProp,
    onSwitchDatabase,
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
    if (databaseNameProp !== undefined) setPickerSelected(databaseNameProp);
  }, [databaseNameProp]);

  async function refreshDatabases(connectionId: ConnectionId): Promise<void> {
    try {
      const list = await ipc.listDatabases(connectionId);
      setDatabases(list);
    } catch {
      setDatabases([]);
    }
  }

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
    if (pickerSelected === name) setPickerSelected(null);
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

  return (
    <section className="connection-panel" aria-label={ConnectionCopy.panelTitle}>
      <div className="connection-panel__header">
        <h2>{ConnectionCopy.panelTitle}</h2>
        {onCollapse ? (
          <button
            type="button"
            data-testid={ConnectionAccessibility.collapseConnection}
            onClick={onCollapse}
          >
            {ConnectionCopy.collapseConnection}
          </button>
        ) : null}
      </div>

      <ConnectionProfileList
        profiles={profiles}
        formVisible={formVisible}
        onSelect={selectProfile}
        onNewProfile={startNewProfile}
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
        />
      ) : null}

      {formVisible ? (
        <>
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

          <ConnectionPanelActions
            busy={busy}
            canConnect={canConnect}
            sessionClaimed={sessionClaimed}
            selectedId={selectedId}
            hideConnect={createdDialogOpen}
            onSave={() => void handleSave()}
            onConnect={() => void handleConnect()}
            onDisconnect={() => void handleDisconnect()}
            onRequestDelete={() => confirm.requestDelete(selectedId)}
            onCancel={() => onFormVisibleChange(false)}
          />
        </>
      ) : null}

      <ConnectionCreatedDialog
        open={createdDialogOpen}
        onConnectNow={() => {
          setCreatedDialogOpen(false);
          void handleConnect();
        }}
        onNotNow={() => setCreatedDialogOpen(false)}
      />

      <ConnectionStatusBanner
        phase={bannerPhase}
        isConnected={sessionClaimed}
        message={bannerMessage ?? undefined}
      />

      {confirm.dialogs}

      {errorMessage ? (
        <p className="connection-panel__status" role="status">
          {errorMessage}
        </p>
      ) : null}
      {formVisible && !canConnect && !sessionClaimed && selectedId === null ? (
        <p className="connection-panel__hint">{ConnectionCopy.connectHint}</p>
      ) : null}
    </section>
  );
}
