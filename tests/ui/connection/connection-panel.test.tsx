/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockDragonIpc, fixtureProfileFields } from "../../../src/ipc/mock";
import { ConnectionAccessibility } from "../../../src/ui/connection/connection-accessibility";
import { ConnectionCopy } from "../../../src/ui/connection/connection-copy";
import { ConnectionPanel } from "../../../src/ui/connection/connection-panel";

afterEach(() => cleanup());

function baseProfileFields() {
  return { ...fixtureProfileFields(), name: "dev" };
}

function sessionPropsFromIpc(ipc: ReturnType<typeof createMockDragonIpc>) {
  return {
    connectProfile: (id: string) => ipc.connectProfile(id),
    disconnectSession: () => ipc.disconnect(),
  };
}

function formGateProps(
  overrides: {
    formVisible?: boolean;
    onFormVisibleChange?: (next: boolean) => void;
    onProfilesLoaded?: (count: number) => void;
  } = {},
) {
  return {
    formVisible: true,
    onFormVisibleChange: vi.fn(),
    onProfilesLoaded: vi.fn(),
    ...overrides,
  };
}

describe("ConnectionPanel sheet dismissal", () => {
  it("Escape closes the connection sheet", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const onFormVisibleChange = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps({ onFormVisibleChange })}
        isConnected={false}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await screen.findByRole("dialog", { name: ConnectionCopy.formTitleNew });
    await user.keyboard("{Escape}");
    expect(onFormVisibleChange).toHaveBeenCalledWith(false);
  });

  it("Escape belongs to the confirm stacked on the sheet, not to the sheet", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    const onFormVisibleChange = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps({ onFormVisibleChange })}
        isConnected={false}
        activeProfileId={saved.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.delete }));
    expect(screen.getByRole("button", { name: ConnectionCopy.confirmDelete })).toBeInTheDocument();
    await user.keyboard("{Escape}");
    // The confirm is the topmost surface, so it takes the key and closes.
    // The sheet stays: closing it under a live confirm would leave the confirm
    // floating with its pending delete still armed.
    expect(onFormVisibleChange).not.toHaveBeenCalledWith(false);
    expect(
      screen.queryByRole("button", { name: ConnectionCopy.confirmDelete }),
    ).not.toBeInTheDocument();

    // Second Escape reaches the sheet, proving it re-arms once nothing is
    // stacked on it.
    await user.keyboard("{Escape}");
    expect(onFormVisibleChange).toHaveBeenCalledWith(false);
  });

  it("keeps Escape off the sheet while the confirmed delete is in flight", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    // The mock resolves in a microtask, so the in-flight window only exists if
    // the request is held open deliberately.
    const heldIpc = { ...ipc, deleteProfile: () => new Promise<void>(() => {}) };
    const onFormVisibleChange = vi.fn();
    render(
      <ConnectionPanel
        ipc={heldIpc}
        {...formGateProps({ onFormVisibleChange })}
        isConnected={false}
        activeProfileId={saved.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.delete }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.confirmDelete }));

    // Busy must not hand the key back to the sheet: the delete is already sent,
    // so closing the sheet would strand the confirm over a live request.
    await user.keyboard("{Escape}");
    expect(onFormVisibleChange).not.toHaveBeenCalledWith(false);
  });
});

/**
 * The brief's rule is that a session action never exists twice at once: the
 * sheet footer owns Connect and Delete while it is open, the sidebar owns them
 * while it is closed. That guarantee is spread across three separate
 * conditionals in three files (the sheet footer's `sessionClaimed`, the header
 * Connect's `!formVisible`, the profile row's `!formVisible`) with nothing but
 * prose holding them in sync — so it is asserted here as one fact.
 */
describe("ConnectionPanel session-action ownership", () => {
  it("offers exactly one Connect and one Delete, whichever surface owns them", async () => {
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });

    const panelProps = {
      ipc,
      isConnected: false,
      activeProfileId: saved.id,
      ...sessionPropsFromIpc(ipc),
      onConnected: vi.fn(),
      onDisconnected: vi.fn(),
      onSwitchSuccess: vi.fn(),
      onSwitchFailure: vi.fn(),
    };

    const { rerender } = render(
      <ConnectionPanel {...panelProps} {...formGateProps({ formVisible: true })} />,
    );

    // Sheet open: its footer owns both.
    await screen.findByRole("dialog", { name: ConnectionCopy.formTitleEdit });
    await waitFor(() => {
      expect(screen.getAllByRole("button", { name: ConnectionCopy.connect })).toHaveLength(1);
    });
    expect(screen.getAllByRole("button", { name: ConnectionCopy.delete })).toHaveLength(1);

    // Sheet closed: the sidebar picks both up, and still only once each.
    rerender(<ConnectionPanel {...panelProps} {...formGateProps({ formVisible: false })} />);
    await waitFor(() => {
      expect(
        screen.queryByRole("dialog", { name: ConnectionCopy.formTitleEdit }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getAllByRole("button", { name: ConnectionCopy.connect })).toHaveLength(1);
    expect(screen.getAllByRole("button", { name: ConnectionCopy.delete })).toHaveLength(1);
  });

  it("reports a blocking surface while the connection form is visible", () => {
    const ipc = createMockDragonIpc("happy");
    const onBlockingChange = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps({ formVisible: true })}
        isConnected={false}
        onBlockingChange={onBlockingChange}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );

    expect(onBlockingChange).toHaveBeenLastCalledWith(true);
  });

  it("reports no blocking surface while the form is closed", () => {
    const ipc = createMockDragonIpc("happy");
    const onBlockingChange = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps({ formVisible: false })}
        isConnected={false}
        onBlockingChange={onBlockingChange}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );

    expect(onBlockingChange).toHaveBeenLastCalledWith(false);
  });

  it("disables header actions while a confirm is pending", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps({ formVisible: true })}
        isConnected={false}
        activeProfileId={saved.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: ConnectionCopy.delete }));
    expect(screen.getByRole("button", { name: ConnectionCopy.confirmDelete })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ConnectionCopy.newProfile })).toBeDisabled();
  });
});

describe("ConnectionPanel Save-then-Connect", () => {
  it("keeps Connect unavailable until the profile is saved", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const onConnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={false}
        {...sessionPropsFromIpc(ipc)}
        onConnected={onConnected}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/host/i), "127.0.0.1");
    await user.type(screen.getByLabelText(/port/i), "5432");
    await user.type(screen.getByLabelText(/username/i), "postgres");
    await user.type(screen.getByLabelText(/database/i), "app");
    await user.type(screen.getByLabelText(/^password$/i), "pw");

    const connect = screen.getByRole("button", { name: ConnectionCopy.connect });
    expect(connect).toBeDisabled();
    expect(onConnected).not.toHaveBeenCalled();
  });

  it("calls onConnected after saveProfile then connectProfile success", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const onConnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={false}
        {...sessionPropsFromIpc(ipc)}
        onConnected={onConnected}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/host/i), "127.0.0.1");
    await user.type(screen.getByLabelText(/username/i), "postgres");
    await user.type(screen.getByLabelText(/database/i), "app");
    await user.type(screen.getByLabelText(/^password$/i), "pw");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connectNow }));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    const result = onConnected.mock.calls[0]?.[0];
    expect(result.connectionId).toBeTruthy();
    expect(result.profileId).toBeTruthy();
    expect(result.connectionId).not.toBe(result.profileId);
  });

  it("calls onConnected via connectProfile prop (not raw ipc.connectProfile for session path)", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const connectProfile = vi.fn(async (id: string) => ipc.connectProfile(id));
    const disconnectSession = vi.fn(async () => ipc.disconnect());
    const onConnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={false}
        connectProfile={connectProfile}
        disconnectSession={disconnectSession}
        onConnected={onConnected}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/host/i), "127.0.0.1");
    await user.type(screen.getByLabelText(/username/i), "postgres");
    await user.type(screen.getByLabelText(/database/i), "app");
    await user.type(screen.getByLabelText(/^password$/i), "pw");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connectNow }));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(connectProfile).toHaveBeenCalled();
  });

  it("hides verify-ca and verify-full SSL options when sshEnabled", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={false}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText(/ssh/i));
    const ssl = screen.getByLabelText(/ssl/i);
    expect(ssl).not.toHaveTextContent(/verify-ca/i);
    expect(ssl).not.toHaveTextContent(/verify-full/i);
    // Options must not be selectable even if present as disabled leftovers:
    expect(screen.queryByRole("option", { name: /verify-ca/i })).toBeNull();
    expect(screen.queryByRole("option", { name: /verify-full/i })).toBeNull();
  });

  it("Disconnect uses disconnectSession prop", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    await ipc.connectProfile(saved.id);
    const disconnectSession = vi.fn(async () => ipc.disconnect());
    const onDisconnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={true}
        activeProfileId={saved.id}
        connectProfile={(id) => ipc.connectProfile(id)}
        disconnectSession={disconnectSession}
        onConnected={vi.fn()}
        onDisconnected={onDisconnected}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await waitFor(() => expect(disconnectSession).toHaveBeenCalled());
    expect(onDisconnected).toHaveBeenCalled();
  });

  it("calls onDisconnected when Disconnect is clicked while Connected", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    await ipc.connectProfile(saved.id);
    const onDisconnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={true}
        activeProfileId={saved.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={onDisconnected}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await waitFor(() => expect(onDisconnected).toHaveBeenCalled());
  });

  it("calls onDisconnected after A teardown during switch before connect B settles", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const a = await ipc.saveProfile({
      profile: { ...baseProfileFields(), name: "A" },
      secrets: { password: "pw" },
    });
    const b = await ipc.saveProfile({
      profile: { ...baseProfileFields(), name: "B", host: "db-b" },
      secrets: { password: "pw" },
    });
    await ipc.connectProfile(a.id);

    let releaseConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const realConnect = ipc.connectProfile.bind(ipc);
    ipc.connectProfile = async (id) => {
      await connectGate;
      return realConnect(id);
    };

    const onDisconnected = vi.fn();
    const onSwitchSuccess = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={true}
        activeProfileId={a.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={onDisconnected}
        onSwitchSuccess={onSwitchSuccess}
        onSwitchFailure={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /^B$/i }));
    await user.click(screen.getByRole("button", { name: /confirm|switch/i }));
    await waitFor(() => expect(onDisconnected).toHaveBeenCalledTimes(1));
    expect(onSwitchSuccess).not.toHaveBeenCalled();

    releaseConnect();
    await waitFor(() =>
      expect(onSwitchSuccess).toHaveBeenCalledWith(expect.objectContaining({ profileId: b.id })),
    );
  });

  it("switch A→B success calls onSwitchSuccess; B failure after A teardown calls onSwitchFailure", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const a = await ipc.saveProfile({
      profile: { ...baseProfileFields(), name: "A" },
      secrets: { password: "pw" },
    });
    const b = await ipc.saveProfile({
      profile: { ...baseProfileFields(), name: "B", host: "db-b" },
      secrets: { password: "pw" },
    });
    await ipc.connectProfile(a.id);

    const onSwitchSuccess = vi.fn();
    const onSwitchFailure = vi.fn();
    const { rerender } = render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={true}
        activeProfileId={a.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={onSwitchSuccess}
        onSwitchFailure={onSwitchFailure}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /^B$/i }));
    await user.click(screen.getByRole("button", { name: /confirm|switch/i }));
    await waitFor(() =>
      expect(onSwitchSuccess).toHaveBeenCalledWith(expect.objectContaining({ profileId: b.id })),
    );

    // Failure path: force connectProfile to reject after selecting B again from A
    await ipc.connectProfile(a.id);
    ipc.connectProfile = async () => {
      throw { kind: "auth", message: "Authentication failed" };
    };
    rerender(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={true}
        activeProfileId={a.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={onSwitchSuccess}
        onSwitchFailure={onSwitchFailure}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /^B$/i }));
    await user.click(screen.getByRole("button", { name: /confirm|switch/i }));
    await waitFor(() =>
      expect(onSwitchFailure).toHaveBeenCalledWith(
        expect.objectContaining({ kind: "auth", message: expect.any(String) }),
      ),
    );
    // Panel must not claim Connected after switch failure
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
  });

  it("keeps Connected claim when disconnect fails during switch and does not call onSwitchFailure", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const a = await ipc.saveProfile({
      profile: { ...baseProfileFields(), name: "A" },
      secrets: { password: "pw" },
    });
    await ipc.saveProfile({
      profile: { ...baseProfileFields(), name: "B", host: "db-b" },
      secrets: { password: "pw" },
    });
    await ipc.connectProfile(a.id);

    ipc.disconnect = async () => {
      throw { kind: "unknown", message: "Disconnect failed" };
    };

    const onSwitchSuccess = vi.fn();
    const onSwitchFailure = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={true}
        activeProfileId={a.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={onSwitchSuccess}
        onSwitchFailure={onSwitchFailure}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /^B$/i }));
    await user.click(screen.getByRole("button", { name: /confirm|switch/i }));
    await waitFor(() => expect(screen.getByText(/disconnect failed/i)).toBeInTheDocument());
    expect(onSwitchFailure).not.toHaveBeenCalled();
    expect(onSwitchSuccess).not.toHaveBeenCalled();
    // Connected claim remains — Disconnect UI still shown
    expect(screen.getByRole("button", { name: /disconnect/i })).toBeInTheDocument();
  });

  it("surfaces human IpcError on connectProfile failure and does not claim Connected", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    ipc.connectProfile = async () => {
      throw { kind: "auth", message: "Authentication failed" };
    };
    const onConnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={false}
        activeProfileId={saved.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={onConnected}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.connect }));
    await waitFor(() => expect(screen.getByText(/authentication failed/i)).toBeInTheDocument());
    expect(onConnected).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull();
  });

  it("deleteProfile removes a saved profile; active connected profile disconnects first", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    await ipc.connectProfile(saved.id);
    const deleteSpy = vi.spyOn(ipc, "deleteProfile");
    const disconnectSession = vi.fn(async () => ipc.disconnect());
    const disconnectSpy = vi.spyOn(ipc, "disconnect");
    const onDisconnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={true}
        activeProfileId={saved.id}
        connectProfile={(id) => ipc.connectProfile(id)}
        disconnectSession={disconnectSession}
        onConnected={vi.fn()}
        onDisconnected={onDisconnected}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /delete/i }));
    await user.click(screen.getByRole("button", { name: /confirm/i }));
    await waitFor(() => expect(deleteSpy).toHaveBeenCalledWith(saved.id));
    expect(disconnectSession).toHaveBeenCalled();
    expect(onDisconnected).toHaveBeenCalled();
    expect(await ipc.getProfile(saved.id)).toBeNull();
    // Session path must go through disconnectSession; raw spy is only via that prop.
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    const sessionOrder = disconnectSession.mock.invocationCallOrder[0];
    const disconnectOrder = disconnectSpy.mock.invocationCallOrder[0];
    if (sessionOrder === undefined || disconnectOrder === undefined) {
      throw new Error("expected disconnectSession and ipc.disconnect invocation orders");
    }
    expect(sessionOrder).toBeLessThan(disconnectOrder);
  });

  it("surfaces listProfiles failure on mount", async () => {
    const ipc = createMockDragonIpc("happy");
    ipc.listProfiles = async () => {
      throw { kind: "unknown", message: "Storage boom" };
    };
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={false}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await waitFor(() => {
      expect(screen.getByRole("status")).toHaveTextContent(/Storage boom/);
    });
  });

  it("shows No connections when the profile list is empty and the form is showing", async () => {
    const ipc = createMockDragonIpc("happy");
    render(
      <ConnectionPanel
        ipc={ipc}
        isConnected={false}
        formVisible={true}
        onFormVisibleChange={vi.fn()}
        onProfilesLoaded={vi.fn()}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    expect(await screen.findByText(ConnectionCopy.noConnections)).toBeInTheDocument();
  });

  it("form-level Cancel hides the form without calling saveProfile", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saveSpy = vi.spyOn(ipc, "saveProfile");
    const onFormVisibleChange = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        isConnected={false}
        formVisible={true}
        onFormVisibleChange={onFormVisibleChange}
        onProfilesLoaded={vi.fn()}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.type(screen.getByLabelText(/host/i), "127.0.0.1");
    await user.click(screen.getByRole("button", { name: ConnectionCopy.cancel }));
    expect(onFormVisibleChange).toHaveBeenCalledWith(false);
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("delete last profile hides the form and reports 0 profiles", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    const onFormVisibleChange = vi.fn();
    const onProfilesLoaded = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
        isConnected={false}
        formVisible={true}
        onFormVisibleChange={onFormVisibleChange}
        onProfilesLoaded={onProfilesLoaded}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /^dev$/i }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.delete }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.confirmDelete }));
    await waitFor(() => expect(onFormVisibleChange).toHaveBeenCalledWith(false));
    expect(onProfilesLoaded).toHaveBeenCalledWith(0);
  });

  it("does not show table names or fail copy while disconnected", async () => {
    const ipc = createMockDragonIpc("happy");
    render(
      <ConnectionPanel
        ipc={ipc}
        isConnected={false}
        formVisible={true}
        onFormVisibleChange={vi.fn()}
        onProfilesLoaded={vi.fn()}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "users" })).toBeNull();
    expect(screen.queryByText(ConnectionCopy.tablesLoadError)).toBeNull();
  });

  it("Save in Connection String mode parses URI into host/user/database and keeps password in secrets", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saveSpy = vi.spyOn(ipc, "saveProfile");
    render(
      <ConnectionPanel
        ipc={ipc}
        isConnected={false}
        formVisible={true}
        onFormVisibleChange={vi.fn()}
        onProfilesLoaded={vi.fn()}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText(ConnectionCopy.connectionStringMode));
    await user.type(
      screen.getByTestId(ConnectionAccessibility.connectionStringField),
      "postgres://alice:s3cret@localhost:5432/app",
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.save }));
    await waitFor(() => expect(saveSpy).toHaveBeenCalled());
    const input = saveSpy.mock.calls[0]?.[0];
    expect(input?.profile.host).toBe("localhost");
    expect(input?.profile.username).toBe("alice");
    expect(input?.profile.database).toBe("app");
    expect(input?.profile).not.toHaveProperty("password");
    expect(input?.secrets.password).toBe("s3cret");
  });

  it("Test on a saved profile sends its profileId so stored secrets are reused", async () => {
    // formValueFromProfile initialises secrets to {} — stored values are never
    // read back into the form — so without the profileId Rust probes with an
    // empty password and Test fails on a profile Connect opens fine.
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: { ...baseProfileFields(), name: "Saved" },
      secrets: { password: "stored-pw" },
    });
    const testSpy = vi.spyOn(ipc, "testConnection");
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={false}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );

    await user.click(await screen.findByRole("button", { name: /^Saved$/i }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.test }));
    await waitFor(() => expect(testSpy).toHaveBeenCalled());
    expect(testSpy).toHaveBeenCalledWith(expect.objectContaining({ profileId: saved.id }));
  });

  it("Test in Connection String mode probes the parsed URI, not the empty field form", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const testSpy = vi.spyOn(ipc, "testConnection");
    render(
      <ConnectionPanel
        ipc={ipc}
        isConnected={false}
        formVisible={true}
        onFormVisibleChange={vi.fn()}
        onProfilesLoaded={vi.fn()}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText(ConnectionCopy.connectionStringMode));
    await user.type(
      screen.getByTestId(ConnectionAccessibility.connectionStringField),
      "postgres://alice:s3cret@localhost:5432/app",
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.test }));
    await waitFor(() => expect(testSpy).toHaveBeenCalled());
    expect(testSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        host: "localhost",
        username: "alice",
        database: "app",
        password: "s3cret",
      }),
    );
  });

  it("Save of a malformed URI shows a parser error and does not call saveProfile", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saveSpy = vi.spyOn(ipc, "saveProfile");
    render(
      <ConnectionPanel
        ipc={ipc}
        isConnected={false}
        formVisible={true}
        onFormVisibleChange={vi.fn()}
        onProfilesLoaded={vi.fn()}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText(ConnectionCopy.connectionStringMode));
    await user.type(screen.getByTestId(ConnectionAccessibility.connectionStringField), "not-a-url");
    await user.click(screen.getByRole("button", { name: ConnectionCopy.save }));
    expect(await screen.findByRole("status")).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("toggling back to individual fields before Save does not fill host/user/database from the URI", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(
      <ConnectionPanel
        ipc={ipc}
        isConnected={false}
        formVisible={true}
        onFormVisibleChange={vi.fn()}
        onProfilesLoaded={vi.fn()}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByLabelText(ConnectionCopy.connectionStringMode));
    await user.type(
      screen.getByTestId(ConnectionAccessibility.connectionStringField),
      "postgres://alice@localhost:5432/app",
    );
    await user.click(screen.getByLabelText(ConnectionCopy.connectionStringMode));
    expect(screen.getByLabelText(/host/i)).toHaveValue("");
    expect(screen.getByLabelText(/username/i)).toHaveValue("");
    expect(screen.getByLabelText(/database/i)).toHaveValue("");
  });

  it("successful Connect clears the test banner without showing Connected copy", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps()}
        isConnected={false}
        activeProfileId={saved.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.test }));
    expect(await screen.findByText(ConnectionCopy.testSuccess)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ConnectionCopy.connect }));
    await waitFor(() => expect(screen.queryByText(ConnectionCopy.testSuccess)).toBeNull());
    expect(screen.queryByText(ConnectionCopy.connected)).toBeNull();
    expect(screen.queryByTestId(ConnectionAccessibility.statusBanner)).toBeNull();
  });

  it("edit mode Connection String URI is read-only and Copy uses YOUR_PASSWORD", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...baseProfileFields(), host: "localhost", username: "alice", database: "app" },
      secrets: { password: "s3cret" },
    });
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    render(
      <ConnectionPanel
        ipc={ipc}
        isConnected={false}
        formVisible={true}
        onFormVisibleChange={vi.fn()}
        onProfilesLoaded={vi.fn()}
        {...sessionPropsFromIpc(ipc)}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(await screen.findByRole("button", { name: /^dev$/i }));
    await user.click(screen.getByLabelText(ConnectionCopy.connectionStringMode));
    expect(screen.getByTestId(ConnectionAccessibility.connectionStringField)).toHaveAttribute(
      "readonly",
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.copyConnectionString }));
    expect(writeText).toHaveBeenCalled();
    expect(String(writeText.mock.calls[0]?.[0])).toContain("YOUR_PASSWORD");
    expect(String(writeText.mock.calls[0]?.[0])).not.toContain("s3cret");
  });

  it("submits Create with Enter, then switches only from Connect", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const createDatabase = vi.spyOn(ipc, "createDatabase");
    const switchDatabase = vi.fn().mockResolvedValue(undefined);
    const panel = render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps({ formVisible: false })}
        isConnected
        activeProfileId="P"
        connectionId="c1"
        databaseName="app"
        connectProfile={vi.fn()}
        disconnectSession={vi.fn()}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
        onSwitchDatabase={switchDatabase}
      />,
    );

    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    const name = screen.getByTestId(ConnectionAccessibility.createDatabaseName);
    await user.type(name, "   {Enter}");
    expect(createDatabase).not.toHaveBeenCalled();
    await user.clear(name);
    await user.type(name, "shop{Enter}");
    await waitFor(() => expect(createDatabase).toHaveBeenCalledTimes(1));
    expect(switchDatabase).not.toHaveBeenCalled();
    expect(screen.getByText(ConnectionCopy.databaseCreated)).toBeInTheDocument();

    await user.keyboard("{Enter}");
    expect(createDatabase).toHaveBeenCalledTimes(1);
    await user.click(screen.getByRole("button", { name: ConnectionCopy.connect }));
    await waitFor(() => expect(switchDatabase).toHaveBeenCalledTimes(1));
    expect(switchDatabase).toHaveBeenCalledWith("shop");
    expect(panel.queryByRole("dialog", { name: ConnectionCopy.createDatabase })).toBeNull();
  });

  it("keeps Connect available when the post-create catalog refresh fails", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "listDatabases").mockRejectedValue(new Error("catalog offline"));
    const switchDatabase = vi.fn().mockResolvedValue(undefined);
    render(
      <ConnectionPanel
        ipc={ipc}
        {...formGateProps({ formVisible: false })}
        isConnected
        activeProfileId="P"
        connectionId="c1"
        databaseName="app"
        connectProfile={vi.fn()}
        disconnectSession={vi.fn()}
        onConnected={vi.fn()}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
        onSwitchDatabase={switchDatabase}
      />,
    );
    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    await user.type(screen.getByTestId(ConnectionAccessibility.createDatabaseName), "shop{Enter}");
    expect(await screen.findByText(ConnectionCopy.databaseCreated)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: ConnectionCopy.connect })).toBeEnabled();
  });
});
