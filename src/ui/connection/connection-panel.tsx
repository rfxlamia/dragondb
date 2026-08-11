import { useEffect, useState } from "react";
import type {
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  IpcError,
  ProfileId,
} from "../../ipc/contract";
import { ConnectionCopy, humanIpcErrorMessage, isIpcError } from "./connection-copy";
import {
  ConnectionForm,
  type ConnectionFormValue,
  emptyConnectionFormValue,
  formValueFromProfile,
} from "./connection-form";

export interface ConnectionPanelProps {
  ipc: DragonIpc;
  isConnected: boolean;
  activeProfileId?: ProfileId;
  onConnected: (result: ConnectResult) => void;
  onDisconnected: () => void;
  onSwitchSuccess: (result: ConnectResult) => void;
  onSwitchFailure: (error: IpcError) => void;
}

function profileLabel(profile: ConnectionProfileDto): string {
  return profile.name?.trim() || profile.host || ConnectionCopy.unnamedProfile;
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

  const canConnect = selectedId !== null && !dirty && !sessionClaimed && !busy;

  async function refreshProfiles(): Promise<ConnectionProfileDto[]> {
    const list = await ipc.listProfiles();
    setProfiles(list);
    return list;
  }

  useEffect(() => {
    setSessionClaimed(isConnected);
    setConnectedProfileId(isConnected ? (activeProfileId ?? null) : null);
  }, [isConnected, activeProfileId]);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
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
    setPendingSwitchId(null);
    setPendingDeleteId(null);
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
  }

  async function handleSave(): Promise<void> {
    setBusy(true);
    setErrorMessage(null);
    try {
      const saved = await ipc.saveProfile({
        id: selectedId ?? undefined,
        profile: form.profile,
        secrets: form.secrets,
      });
      setSelectedId(saved.id);
      setForm(formValueFromProfile(saved));
      setDirty(false);
      await refreshProfiles();
    } catch (error) {
      setErrorMessage(humanIpcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  async function handleConnect(): Promise<void> {
    if (!canConnect || selectedId === null) return;
    setBusy(true);
    setErrorMessage(null);
    try {
      const result = await ipc.connectProfile(selectedId);
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
      await ipc.disconnect();
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
      await ipc.disconnect();
      setSessionClaimed(false);
      setConnectedProfileId(null);
      const result = await ipc.connectProfile(targetId);
      setSessionClaimed(true);
      setConnectedProfileId(result.profileId);
      setSelectedId(targetId);
      const target = profiles.find((p) => p.id === targetId);
      if (target) {
        setForm(formValueFromProfile(target));
        setDirty(false);
      }
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
        await ipc.disconnect();
        setSessionClaimed(false);
        setConnectedProfileId(null);
        onDisconnected();
      }
      await ipc.deleteProfile(id);
      if (selectedId === id) {
        startNewProfile();
      }
      await refreshProfiles();
    } catch (error) {
      setErrorMessage(humanIpcErrorMessage(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="connection-panel" aria-label={ConnectionCopy.panelTitle}>
      <h2>{ConnectionCopy.panelTitle}</h2>

      <div className="connection-panel__profiles">
        <h3>{ConnectionCopy.profilesHeading}</h3>
        <button type="button" onClick={startNewProfile}>
          {ConnectionCopy.newProfile}
        </button>
        <ul>
          {profiles.map((profile) => (
            <li key={profile.id}>
              <button type="button" onClick={() => selectProfile(profile)}>
                {profileLabel(profile)}
              </button>
            </li>
          ))}
        </ul>
      </div>

      <ConnectionForm value={form} onChange={updateForm} />

      <div className="connection-panel__actions">
        <button type="button" onClick={() => void handleSave()} disabled={busy}>
          {ConnectionCopy.save}
        </button>

        {sessionClaimed ? (
          <button type="button" onClick={() => void handleDisconnect()} disabled={busy}>
            {ConnectionCopy.disconnect}
          </button>
        ) : (
          <button type="button" onClick={() => void handleConnect()} disabled={!canConnect}>
            {ConnectionCopy.connect}
          </button>
        )}

        {selectedId !== null ? (
          <button
            type="button"
            onClick={() => {
              setPendingDeleteId(selectedId);
              setPendingSwitchId(null);
            }}
            disabled={busy}
          >
            {ConnectionCopy.delete}
          </button>
        ) : null}
      </div>

      {pendingSwitchId !== null ? (
        <div className="connection-panel__confirm" role="dialog" aria-label="Switch connection">
          <p>{ConnectionCopy.switchPrompt}</p>
          <button type="button" onClick={() => void confirmSwitch()} disabled={busy}>
            {ConnectionCopy.confirmSwitch}
          </button>
          <button type="button" onClick={() => setPendingSwitchId(null)} disabled={busy}>
            {ConnectionCopy.cancel}
          </button>
        </div>
      ) : null}

      {pendingDeleteId !== null ? (
        <div className="connection-panel__confirm" role="dialog" aria-label="Delete profile">
          <p>{ConnectionCopy.deletePrompt}</p>
          <button type="button" onClick={() => void confirmDelete()} disabled={busy}>
            {ConnectionCopy.confirmDelete}
          </button>
          <button type="button" onClick={() => setPendingDeleteId(null)} disabled={busy}>
            {ConnectionCopy.cancel}
          </button>
        </div>
      ) : null}

      {errorMessage ? <p role="status">{errorMessage}</p> : null}
      {!canConnect && !sessionClaimed && selectedId === null ? (
        <p>{ConnectionCopy.connectHint}</p>
      ) : null}
    </section>
  );
}
