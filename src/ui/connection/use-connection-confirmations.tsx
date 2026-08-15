import { type Dispatch, type SetStateAction, useState } from "react";
import type {
  ConnectionProfileDto,
  ConnectResult,
  DragonIpc,
  IpcError,
  ProfileId,
} from "../../ipc/contract";
import { ConnectionConfirmDialog } from "./connection-confirm-dialog";
import { ConnectionCopy, humanIpcErrorMessage, isIpcError } from "./connection-copy";
import {
  type ConnectionFormValue,
  emptyConnectionFormValue,
  formValueFromProfile,
} from "./connection-form";

function toIpcError(error: unknown): IpcError {
  if (isIpcError(error)) return error;
  return { kind: "unknown", message: humanIpcErrorMessage(error) };
}

export type ConnectionConfirmationsArgs = {
  ipc: DragonIpc;
  profiles: ConnectionProfileDto[];
  selectedId: ProfileId | null;
  sessionClaimed: boolean;
  connectedProfileId: ProfileId | null;
  activeProfileId?: ProfileId;
  busy: boolean;
  connectProfile: (id: ProfileId) => Promise<ConnectResult>;
  disconnectSession: () => Promise<void>;
  onDisconnected: () => void;
  onSwitchSuccess: (result: ConnectResult) => void;
  onSwitchFailure: (error: IpcError) => void;
  onFormVisibleChange: (next: boolean) => void;
  onProfilesLoaded: (count: number) => void;
  resetUriMode: () => void;
  setSelectedId: Dispatch<SetStateAction<ProfileId | null>>;
  setForm: Dispatch<SetStateAction<ConnectionFormValue>>;
  setDirty: Dispatch<SetStateAction<boolean>>;
  setSessionClaimed: Dispatch<SetStateAction<boolean>>;
  setConnectedProfileId: Dispatch<SetStateAction<ProfileId | null>>;
  setErrorMessage: Dispatch<SetStateAction<string | null>>;
  setBusy: Dispatch<SetStateAction<boolean>>;
  setProfiles: Dispatch<SetStateAction<ConnectionProfileDto[]>>;
};

/** Switch/delete confirmation state, IPC orchestration, and dialogs. */
export function useConnectionConfirmations(args: ConnectionConfirmationsArgs): {
  requestSwitch: (id: ProfileId) => void;
  requestDelete: (id: ProfileId | null) => void;
  clearPending: () => void;
  dialogs: React.JSX.Element;
} {
  const [pendingSwitchId, setPendingSwitchId] = useState<ProfileId | null>(null);
  const [pendingDeleteId, setPendingDeleteId] = useState<ProfileId | null>(null);
  const {
    ipc,
    profiles,
    selectedId,
    sessionClaimed,
    connectedProfileId,
    activeProfileId,
    busy,
    connectProfile,
    disconnectSession,
    onDisconnected,
    onSwitchSuccess,
    onSwitchFailure,
    onFormVisibleChange,
    onProfilesLoaded,
    resetUriMode,
    setSelectedId,
    setForm,
    setDirty,
    setSessionClaimed,
    setConnectedProfileId,
    setErrorMessage,
    setBusy,
    setProfiles,
  } = args;

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
      const list = await ipc.listProfiles();
      setProfiles(list);
      onProfilesLoaded(list.length);
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

  return {
    requestSwitch(id) {
      setPendingSwitchId(id);
      setPendingDeleteId(null);
    },
    requestDelete(id) {
      setPendingDeleteId(id);
      setPendingSwitchId(null);
    },
    clearPending() {
      setPendingSwitchId(null);
      setPendingDeleteId(null);
    },
    dialogs: (
      <>
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
      </>
    ),
  };
}
