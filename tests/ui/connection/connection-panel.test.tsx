/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createMockDragonIpc, fixtureProfileFields } from "../../../src/ipc/mock";
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

describe("ConnectionPanel Save-then-Connect", () => {
  it("keeps Connect unavailable until the profile is saved", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const onConnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
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

    const connect = screen.getByRole("button", { name: /connect/i });
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
    await user.click(await screen.findByRole("button", { name: /connect/i }));
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
    await user.click(await screen.findByRole("button", { name: /connect/i }));
    await waitFor(() => expect(onConnected).toHaveBeenCalled());
    expect(connectProfile).toHaveBeenCalled();
  });

  it("hides verify-ca and verify-full SSL options when sshEnabled", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(
      <ConnectionPanel
        ipc={ipc}
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
        isConnected={false}
        activeProfileId={saved.id}
        {...sessionPropsFromIpc(ipc)}
        onConnected={onConnected}
        onDisconnected={vi.fn()}
        onSwitchSuccess={vi.fn()}
        onSwitchFailure={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: /connect/i }));
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
    const onDisconnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
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
  });

  it("delete active connected profile calls disconnectSession not raw ipc.disconnect", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: baseProfileFields(),
      secrets: { password: "pw" },
    });
    await ipc.connectProfile(saved.id);
    const disconnectSession = vi.fn(async () => ipc.disconnect());
    const disconnectSpy = vi.spyOn(ipc, "disconnect");
    const onDisconnected = vi.fn();
    render(
      <ConnectionPanel
        ipc={ipc}
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
    await waitFor(() => expect(disconnectSession).toHaveBeenCalled());
    expect(onDisconnected).toHaveBeenCalled();
    // Session path must go through disconnectSession; raw spy is only via that prop.
    expect(disconnectSpy).toHaveBeenCalledTimes(1);
    expect(disconnectSession.mock.invocationCallOrder[0]).toBeLessThan(
      disconnectSpy.mock.invocationCallOrder[0]!,
    );
  });

  it("surfaces listProfiles failure on mount", async () => {
    const ipc = createMockDragonIpc("happy");
    ipc.listProfiles = async () => {
      throw { kind: "unknown", message: "Storage boom" };
    };
    render(
      <ConnectionPanel
        ipc={ipc}
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
});
