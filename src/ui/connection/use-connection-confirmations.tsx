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
  /** A confirm is on screen above the sheet — the sheet must not take Escape. */
  hasPending: boolean;
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

  // Clear only the confirm this call opened: a settle that lands after the
  // user has already asked for the next one must not wipe that one's dialog.
  function clearPendingDelete(id: ProfileId): void {
    setPendingDeleteId((current) => (current === id ? null : current));
  }

  async function confirmSwitch(): Promise<void> {
    if (pendingSwitchId === null) return;
    // Unlike confirmDelete, this clears before the await: a switch confirm
    // strands nothing by unmounting, and holding it open across
    // disconnect-then-connect would freeze a dead question on screen for the
    // length of two round trips.
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
    // The confirm stays mounted (disabled, via its `busy` prop) until the
    // request settles. Clearing it here instead would unmount the topmost
    // surface mid-flight and hand Escape back to the sheet underneath, which
    // would then close over a delete already sent.
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
      clearPendingDelete(id);
      setBusy(false);
    }
  }

  return {
    hasPending: pendingSwitchId !== null || pendingDeleteId !== null,
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
