import { useEffect, useState } from "react";
import type {
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  IpcError,
  ProfileId,
  TableRef,
} from "../../ipc/contract";
import { ConnectionStringParseError, parseConnectionString } from "../../lib/connection-string";
import { ConnectionConfirmDialog } from "./connection-confirm-dialog";
import { ConnectionCopy, humanIpcErrorMessage, isIpcError } from "./connection-copy";
import {
  ConnectionForm,
  type ConnectionFormValue,
  emptyConnectionFormValue,
  formValueFromProfile,
} from "./connection-form";
import { ConnectionPanelActions } from "./connection-panel-actions";
import { ConnectionProfileList } from "./connection-profile-list";
import { ConnectionTablesList } from "./connection-tables-list";
import { copyUriForProfile, profileFromParsedUri } from "./connection-uri";
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

function toIpcError(error: unknown): IpcError {
  if (isIpcError(error)) return error;
  return { kind: "unknown", message: humanIpcErrorMessage(error) };
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
    onSwitchSuccess,
    onSwitchFailure,
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
  const [pendingSwitchId, setPendingSwitchId] = useState<ProfileId | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<ProfileId | null>(null);
  const [busy, setBusy] = useState(false);
  const [connectionStringMode, setConnectionStringMode] = useState(false);
  const [connectionStringDraft, setConnectionStringDraft] = useState("");

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

  function resetUriMode(): void {
    setConnectionStringMode(false);
    setConnectionStringDraft("");
  }

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
    setPendingSwitchId(null);
    setPendingDeleteId(null);
    resetUriMode();
    onFormVisibleChange(true);
  }

  function selectProfile(profile: ConnectionProfileDto): void {
    setErrorMessage(null);
    // Prefer parent activeProfileId so switch still confirms when App session lags behind panel.
    const liveId = sessionClaimed ? (activeProfileId ?? connectedProfileId ?? selectedId) : null;
    if (liveId !== null && profile.id !== liveId) {
      setPendingSwitchId(profile.id);
      setPendingDeleteId(null);
      return;
    }
    setSelectedId(profile.id);
    setForm(formValueFromProfile(profile));
    setDirty(false);
    setPendingSwitchId(null);
    resetUriMode();
    onFormVisibleChange(true);
  }

  async function handleCopyConnectionString(): Promise<void> {
    const uri = selectedId !== null ? copyUriForProfile(form.profile) : connectionStringDraft;
    await navigator.clipboard.writeText(uri);
  }

  async function handleSave(): Promise<void> {
    setBusy(true);
    setErrorMessage(null);
    try {
      let profile = form.profile;
      let secrets = form.secrets;
      if (connectionStringMode && selectedId === null) {
        const parsed = parseConnectionString(connectionStringDraft);
        profile = profileFromParsedUri(form.profile, parsed);
        secrets = {
          ...form.secrets,
          ...(parsed.password !== undefined ? { password: parsed.password } : {}),
        };
      }
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

  async function confirmSwitch(): Promise<void> {
    if (pendingSwitchId === null) return;
    const targetId = pendingSwitchId;
    setPendingSwitchId(null);
    setBusy(true);
    setErrorMessage(null);
    try {
      await disconnectSession();
    } catch (error) {
      // Keep Connected claim; disconnect failure is not connect-B failure.
      setErrorMessage(humanIpcErrorMessage(error));
      setBusy(false);
      return;
    }
    // A torn down — clear claim before attempting B.
    setSessionClaimed(false);
    setConnectedProfileId(null);
    onDisconnected();
    try {
      const result = await connectProfile(targetId);
      setSessionClaimed(true);
      setConnectedProfileId(result.profileId);
      setSelectedId(targetId);
      const target = profiles.find((p) => p.id === targetId);
      if (target) {
        setForm(formValueFromProfile(target));
        setDirty(false);
      }
      resetUriMode();
      onSwitchSuccess(result);
    } catch (error) {
      setSessionClaimed(false);
      setConnectedProfileId(null);
      const ipcError = toIpcError(error);
      setErrorMessage(ipcError.message);
      onSwitchFailure(ipcError);
    } finally {
      setBusy(false);
    }
  }

  async function confirmDelete(): Promise<void> {
    if (pendingDeleteId === null) return;
    const id = pendingDeleteId;
    setPendingDeleteId(null);
    setBusy(true);
    setErrorMessage(null);
    try {
      const liveId = connectedProfileId ?? activeProfileId ?? selectedId;
      const isActiveConnected = sessionClaimed && liveId === id;
      if (isActiveConnected) {
        await disconnectSession();
        setSessionClaimed(false);
        setConnectedProfileId(null);
        onDisconnected();
      }
      await ipc.deleteProfile(id);
      const list = await refreshProfiles();
      if (selectedId === id) {
        setSelectedId(null);
        setForm(emptyConnectionFormValue());
        setDirty(false);
        setErrorMessage(null);
        resetUriMode();
      }
      if (list.length === 0) {
        onFormVisibleChange(false);
      }
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
            connectionStringMode={connectionStringMode}
            onConnectionStringModeChange={(next) => {
              setConnectionStringMode(next);
              setErrorMessage(null);
            }}
            connectionStringValue={
              selectedId !== null ? copyUriForProfile(form.profile) : connectionStringDraft
            }
            onConnectionStringChange={(next) => {
              setConnectionStringDraft(next);
              setDirty(true);
              setErrorMessage(null);
            }}
            connectionStringReadOnly={selectedId !== null}
            onCopyConnectionString={() => void handleCopyConnectionString()}
          />

          <ConnectionPanelActions
            busy={busy}
            canConnect={canConnect}
            sessionClaimed={sessionClaimed}
            selectedId={selectedId}
            onSave={() => void handleSave()}
            onConnect={() => void handleConnect()}
            onDisconnect={() => void handleDisconnect()}
            onRequestDelete={() => {
              setPendingDeleteId(selectedId);
              setPendingSwitchId(null);
            }}
            onCancel={() => onFormVisibleChange(false)}
          />
        </>
      ) : null}

      {pendingSwitchId !== null ? (
        <ConnectionConfirmDialog
          title="Switch connection"
          prompt={ConnectionCopy.switchPrompt}
          confirmLabel={ConnectionCopy.confirmSwitch}
          busy={busy}
          onConfirm={() => void confirmSwitch()}
          onCancel={() => setPendingSwitchId(null)}
        />
      ) : null}

      {pendingDeleteId !== null ? (
        <ConnectionConfirmDialog
          title="Delete profile"
          prompt={ConnectionCopy.deletePrompt}
          confirmLabel={ConnectionCopy.confirmDelete}
          busy={busy}
          onConfirm={() => void confirmDelete()}
          onCancel={() => setPendingDeleteId(null)}
        />
      ) : null}

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
