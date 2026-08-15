import { useEffect, useState } from "react";
import type {
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  IpcError,
  ProfileId,
  TableRef,
} from "../../ipc/contract";
import { ConnectionStringParseError } from "../../lib/connection-string";
import { ConnectionCopy, humanIpcErrorMessage } from "./connection-copy";
import {
  ConnectionForm,
  type ConnectionFormValue,
  emptyConnectionFormValue,
  formValueFromProfile,
} from "./connection-form";
import { ConnectionPanelActions } from "./connection-panel-actions";
import { ConnectionProfileList } from "./connection-profile-list";
import { ConnectionTablesList } from "./connection-tables-list";
import { useConnectionConfirmations } from "./use-connection-confirmations";
import { useConnectionStringMode } from "./use-connection-string-mode";
import "./connection.css";

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
  } = props;

  const [profiles, setProfiles] = useState<ConnectionProfileDto[]>([]);
  const [selectedId, setSelectedId] = useState<ProfileId | null>(activeProfileId ?? null);
  const [form, setForm] = useState<ConnectionFormValue>(emptyConnectionFormValue);
  const [dirty, setDirty] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
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
  }, [isConnected, activeProfileId]);

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

  async function handleConnect(): Promise<void> {
    if (!canConnect || selectedId === null) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const result = await connectProfile(selectedId);
      setSessionClaimed(true);
      setConnectedProfileId(result.profileId);
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
      onDisconnected();
    } catch (error) {
      setErrorMessage(humanIpcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="connection-panel" aria-label={ConnectionCopy.panelTitle}>
      <h2>{ConnectionCopy.panelTitle}</h2>

      <ConnectionProfileList
        profiles={profiles}
        formVisible={formVisible}
        onSelect={selectProfile}
        onNewProfile={startNewProfile}
      />

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
            onSave={() => void handleSave()}
            onConnect={() => void handleConnect()}
            onDisconnect={() => void handleDisconnect()}
            onRequestDelete={() => confirm.requestDelete(selectedId)}
            onCancel={() => onFormVisibleChange(false)}
          />
        </>
      ) : null}

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
