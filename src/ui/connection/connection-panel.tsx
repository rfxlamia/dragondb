import { useCallback, useEffect, useImperativeHandle, useState } from "react";
import type {
  ConnectionId,
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  IpcError,
  ProfileId,
} from "../../ipc/contract";
import { ConnectionStringParseError } from "../../lib/connection-string";
import { ChevronDownIcon, ChevronRightIcon, ConnectIcon, DisconnectIcon, PlusIcon } from "../icons";
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
import { useConnectionConfirmations } from "./use-connection-confirmations";
import { useConnectionStringMode } from "./use-connection-string-mode";
import "./connection.css";
import "./connection-panel.css";

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
  connectionId?: ConnectionId | null;
  databaseName?: string | null;
  /** Session switchDatabase — picker must not rewrite profile.database. */
  onSwitchDatabase?: (name: string) => Promise<void>;
  /** Clear session/tab database selection when the active catalog is dropped. */
  onClearDatabase?: () => Promise<void>;
  missingDatabase?: boolean;
  /** Session connect via store (generation-guarded). Profile CRUD stays on ipc. */
  connectProfile: (id: ProfileId) => Promise<ConnectResult>;
  /** Session disconnect via store (orchestrator clear). Never raw ipc.disconnect for live session. */
  disconnectSession: () => Promise<void>;
  onConnected: (result: ConnectResult) => void;
  onDisconnected: () => void;
  onSwitchSuccess: (result: ConnectResult) => void;
  onSwitchFailure: (error: IpcError) => void;
  /** True while a sheet or confirm owns this panel, so the shell can freeze the
      sidebar's view switch — a fixed-position sheet would otherwise be stranded
      over a body that is no longer there. */
  onBlockingChange?: (blocking: boolean) => void;
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
    connectProfile,
    disconnectSession,
    onConnected,
    onDisconnected,
    connectionId: connectionIdProp,
    databaseName: databaseNameProp,
    onSwitchDatabase,
    onClearDatabase,
    missingDatabase = false,
    onBlockingChange,
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

  const [pickerBlocking, setPickerBlocking] = useState(false);
  const [connectionsExpanded, setConnectionsExpanded] = useState(true);
  const blocking = formVisible || confirm.hasPending || pickerBlocking;
  const collapseBlocked = blocking || bannerPhase !== "idle";
  useEffect(() => {
    onBlockingChange?.(blocking);
    return () => onBlockingChange?.(false);
  }, [blocking, onBlockingChange]);

  useEffect(() => {
    if (!sessionClaimed) setPickerBlocking(false);
  }, [sessionClaimed]);

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
      const { profile, secrets } = uri.applyParseOnSave(form, selectedId);
      await ipc.testConnection({
        // The form never holds a saved profile's stored secrets, so Rust fills
        // the omitted ones from this profile's keyring entry.
        profileId: selectedId,
        host: profile.host,
        port: profile.port,
        username: profile.username,
        database: profile.database,
        sslMode: profile.sslMode,
        sshEnabled: profile.sshEnabled,
        sshHost: profile.sshHost,
        sshPort: profile.sshPort,
        sshUsername: profile.sshUsername,
        sshAuthMethod: profile.sshAuthMethod,
        password: secrets.password,
        sshPassword: secrets.sshPassword,
        sshPrivateKey: secrets.sshPrivateKey,
        sshPassphrase: secrets.sshPassphrase,
      });
      await waitRemaining(startedAt, TEST_BANNER_MIN_MS);
      setBannerPhase("success");
    } catch (error) {
      await waitRemaining(startedAt, TEST_BANNER_MIN_MS);
      setBannerPhase("error");
      if (error instanceof ConnectionStringParseError) {
        setBannerMessage(error.message);
      } else {
        setBannerMessage(humanIpcErrorMessage(error));
      }
    }
  }

  async function handleSelectDatabase(name: string): Promise<void> {
    if (name === pickerSelected) return;
    if (onSwitchDatabase) await onSwitchDatabase(name);
    setPickerSelected(name);
  }

  async function handleCreateDatabase(name: string): Promise<void> {
    await ipc.createDatabase(name);
    if (liveConnectionId) await refreshDatabases(liveConnectionId);
  }

  async function handleConnectCreatedDatabase(name: string): Promise<void> {
    if (name === pickerSelected) return;
    if (onSwitchDatabase) await onSwitchDatabase(name);
    setPickerSelected(name);
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
      {!formVisible && bannerPhase !== "idle" ? statusBanner : null}
      {!formVisible ? errorText : null}

      <div className="connection-panel__connections">
        <div className="connection-panel__connections-header">
          <button
            type="button"
            className="connection-panel__connections-toggle"
            data-testid={ConnectionAccessibility.connectionsToggle}
            aria-expanded={connectionsExpanded}
            aria-label={ConnectionCopy.toggleConnections}
            disabled={collapseBlocked}
            onClick={() => setConnectionsExpanded((open) => !open)}
          >
            {connectionsExpanded ? <ChevronDownIcon /> : <ChevronRightIcon />}
            <span className="connection-panel__connections-label">{ConnectionCopy.panelTitle}</span>
          </button>
          <div className="connection-panel__connections-actions">
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
            <button
              type="button"
              className="ui-icon-btn ui-icon-btn--accent"
              aria-label={ConnectionCopy.newProfile}
              title={ConnectionCopy.newProfile}
              onClick={startNewProfile}
            >
              <PlusIcon />
            </button>
          </div>
        </div>

        {connectionsExpanded ? (
          <div className="connection-panel__connections-body">
            <ConnectionProfileList
              profiles={profiles}
              formVisible={formVisible}
              onSelect={selectProfile}
              onNewProfile={startNewProfile}
              activeId={sessionClaimed ? (connectedProfileId ?? selectedId) : selectedId}
              onRequestDelete={(profile) => confirm.requestDelete(profile.id)}
              hideHeader
            />

            {sessionClaimed && selectedId !== null ? (
              <ConnectionDatabasePicker
                isConnected={sessionClaimed}
                databases={databases}
                selected={pickerSelected}
                onSelect={handleSelectDatabase}
                profileDatabase={form.profile.database}
                missingFromList={
                  missingDatabase ||
                  (pickerSelected !== null && !databases.includes(pickerSelected))
                }
                onCreateDatabase={handleCreateDatabase}
                onConnectDatabase={handleConnectCreatedDatabase}
                onDeleteDatabase={handleDeleteDatabase}
                onBlockingChange={setPickerBlocking}
              />
            ) : null}
          </div>
        ) : null}
      </div>

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
