/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/ipc/tauri-client", () => ({
  createTauriDragonIpc: vi.fn(() => {
    throw new Error("production default must not invoke Tauri in unit tests without inject");
  }),
}));

const menuListen = vi.hoisted(() => {
  let registeredListener: ((event: { payload: string }) => void) | undefined;
  return {
    listen: vi.fn(async (_event: string, listener: (event: { payload: string }) => void) => {
      registeredListener = listener;
      return () => {
        if (registeredListener === listener) {
          registeredListener = undefined;
        }
      };
    }),
    emit(id: string) {
      registeredListener?.({ payload: id });
    },
    reset() {
      registeredListener = undefined;
    },
  };
});

vi.mock("@tauri-apps/api/event", () => ({
  listen: (event: string, listener: (event: { payload: string }) => void) =>
    menuListen.listen(event, listener),
}));

import type { UserEvent } from "@testing-library/user-event";
import App from "../../src/App";
import type { DragonIpc, SavedQueryDto } from "../../src/ipc/contract";
import {
  createMockDragonIpc,
  FIXTURE_CONNECTION_ID,
  fixtureProfileFields,
} from "../../src/ipc/mock";
import { ConnectionAccessibility } from "../../src/ui/connection/connection-accessibility";
import { ConnectionCopy } from "../../src/ui/connection/connection-copy";
import { HelpAccessibility } from "../../src/ui/help/help-accessibility";
import { HelpCopy } from "../../src/ui/help/help-copy";
import { QueriesAccessibility } from "../../src/ui/library/queries-accessibility";
import { QueriesCopy } from "../../src/ui/library/queries-copy";
import { ResultsAccessibility } from "../../src/ui/results/results-accessibility";
import { ResultsCopy } from "../../src/ui/results/results-copy";
import { TabBarAccessibility } from "../../src/ui/shell/tab-bar-accessibility";
import type { MenuEventId } from "../../src/ui/shell/workspace-accelerators";
import { VisualQueryAccessibility } from "../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../src/ui/visual-query/copy";
import { WelcomeAccessibility } from "../../src/ui/welcome/welcome-accessibility";
import { WelcomeCopy } from "../../src/ui/welcome/welcome-copy";

function emitTauriMenuForTest(id: MenuEventId): void {
  menuListen.emit(id);
}

afterEach(() => {
  cleanup();
  menuListen.reset();
  localStorage.clear();
});

async function connectFirst(user: UserEvent, _ipc: DragonIpc): Promise<void> {
  await waitFor(() => {
    expect(
      screen.queryByRole("button", { name: WelcomeCopy.connectToServer }) ??
        screen.queryByLabelText(/host/i),
    ).not.toBeNull();
  });
  const connectToServer = screen.queryByRole("button", { name: WelcomeCopy.connectToServer });
  if (connectToServer) {
    await user.click(connectToServer);
  }
  const disconnect = screen.queryByRole("button", { name: /disconnect/i });
  if (disconnect) {
    await user.click(disconnect);
    await waitFor(() => expect(screen.queryByRole("button", { name: /disconnect/i })).toBeNull());
  }
  const newProfile = screen.queryByRole("button", { name: ConnectionCopy.newProfile });
  if (newProfile) {
    await user.click(newProfile);
  }
  await user.type(screen.getByLabelText(/host/i), "127.0.0.1");
  await user.type(screen.getByLabelText(/username/i), "postgres");
  await user.type(screen.getByLabelText(ConnectionCopy.database), "app");
  await user.type(screen.getByLabelText(/^password$/i), "pw");
  await user.click(screen.getByRole("button", { name: /save/i }));
  await user.click(await screen.findByRole("button", { name: ConnectionCopy.connectNow }));
  await waitFor(() =>
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).not.toBeDisabled(),
  );
}

describe("App production default (no runtime mock)", () => {
  it("App.tsx default path uses createTauriDragonIpc, not createMockDragonIpc", () => {
    const src = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(src).toMatch(/createTauriDragonIpc/);
    expect(src).not.toMatch(/const DEFAULT_IPC\s*=\s*createMockDragonIpc/);
    expect(src).not.toMatch(/FIXTURE_CONNECTION_ID/);
    // Lazy: factory must not be invoked at module scope
    expect(src).not.toMatch(/const DEFAULT_IPC\s*=\s*createTauriDragonIpc\s*\(/);
  });

  it("starts disconnected — canvas mutate controls locked until connect", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await user.click(await screen.findByRole("button", { name: WelcomeCopy.connectToServer }));
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).toBeDisabled();
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    expect(screen.getAllByTestId(VisualQueryAccessibility.runQuery)).toHaveLength(1);
  });

  it("workspace with 1 tab hides the tab strip, shows New Tab, canvas History, and no Export", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    expect(await screen.findByTestId(TabBarAccessibility.newTab)).toBeInTheDocument();
    expect(screen.queryByTestId(TabBarAccessibility.strip)).toBeNull();
    expect(screen.getByTestId(VisualQueryAccessibility.history)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
  });
});

describe("App session connect / disconnect / switch", () => {
  it("on connect success unlocks canvas and listTables uses returned connectionId", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const listTables = vi.spyOn(ipc, "listTables");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    await waitFor(() => expect(listTables).toHaveBeenCalledTimes(1));
    const connectionId = listTables.mock.calls[0]?.[0];
    expect(connectionId).toBeTruthy();
    expect(connectionId).not.toBe(FIXTURE_CONNECTION_ID);
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).not.toBeDisabled();
  });

  it("after connect, connection column shows public.users table display name", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    const tables = await screen.findByTestId(ConnectionAccessibility.tablesRegion);
    expect(tables).toHaveTextContent("users");
  });

  it("listColumns on FROM commit uses live connectionId, not FIXTURE", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const listColumns = vi.spyOn(ipc, "listColumns");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );

    await waitFor(() => expect(listColumns).toHaveBeenCalled());
    expect(listColumns.mock.calls[0]?.[0]).not.toBe(FIXTURE_CONNECTION_ID);
  });

  it("disconnect locks canvas and hides generated SQL unless the dialog is opened", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByRole("button", { name: /disconnect/i }));

    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    expect(screen.queryByTestId(VisualQueryAccessibility.generatedSQLText)).toBeNull();
    expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).toBeDisabled();
    expect(screen.getByTestId(VisualQueryAccessibility.viewGeneratedSQL)).toBeDisabled();
  });

  it("disconnect then connect a different profile remounts canvas empty for B", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(await screen.findByRole("button", { name: /connect/i }));
    await waitFor(() =>
      expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument(),
    );
  });

  it("disconnect then reconnect the same profile keeps the card snapshot", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await user.click(await screen.findByRole("button", { name: /connect/i }));
    await waitFor(() =>
      expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).not.toBeDisabled(),
    );
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
  });

  it("locks canvas after switch A teardown while connect B is in flight", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    let releaseConnect!: () => void;
    const connectGate = new Promise<void>((resolve) => {
      releaseConnect = resolve;
    });
    const realConnect = ipc.connectProfile.bind(ipc);
    let connectCalls = 0;
    ipc.connectProfile = async (id) => {
      connectCalls += 1;
      if (connectCalls > 1) {
        await connectGate;
      }
      return realConnect(id);
    };

    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).not.toBeDisabled();

    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(screen.getByRole("button", { name: /confirm switch/i }));
    await waitFor(() =>
      expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).toBeDisabled(),
    );
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();

    releaseConnect();
    await waitFor(() =>
      expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument(),
    );
  });

  it("successful switch remounts canvas empty for B", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    // Save B before render so ConnectionPanel listProfiles on mount includes it
    await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(screen.getByRole("button", { name: /confirm switch/i }));
    await waitFor(() =>
      expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument(),
    );
  });

  it("failed switch after A teardown keeps locked snapshot and shows human error", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const b = await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));

    const realConnect = ipc.connectProfile.bind(ipc);
    ipc.connectProfile = async (id) => {
      if (id === b.id) throw { kind: "auth", message: "Authentication failed" };
      return realConnect(id);
    };

    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(screen.getByRole("button", { name: /confirm switch/i }));
    // ConnectionPanel already surfaces errorMessage; App locks canvas via onSwitchFailure
    await waitFor(() => expect(screen.getByText(/Authentication failed/i)).toBeInTheDocument());
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).toBeDisabled();
  });

  it("after failed switch to B, connecting to B remounts canvas empty (AC Session)", async () => {
    // Spec: Switch fail keeps A cards as snapshot; later connect to different profile B
    // must remount empty — same as disconnect→connect different profile.
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const b = await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();

    const realConnect = ipc.connectProfile.bind(ipc);
    let failB = true;
    ipc.connectProfile = async (id) => {
      if (failB && id === b.id) throw { kind: "auth", message: "Authentication failed" };
      return realConnect(id);
    };

    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(screen.getByRole("button", { name: /confirm switch/i }));
    await waitFor(() => expect(screen.getByText(/Authentication failed/i)).toBeInTheDocument());
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();

    failB = false;
    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(await screen.findByRole("button", { name: /connect/i }));
    await waitFor(() =>
      expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument(),
    );
  });

  it("disconnect after Run preserves clause cards (store clear covered by unit oracle)", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 9,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(/OK\s*\//i);
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    // Cards preserved as locked snapshot (SP-2 dual-exit)
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).toBeDisabled();
    // Status strip must not keep connected OK result as live run outcome after disconnect
    // (canvas may clear local runOutcome on disconnect lock; store results cleared via orchestrator)
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: /export/i })).toBeNull();
  });

  it("failed switch after teardown keeps card snapshot and does not leave live OK status", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const b = await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 3,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(/OK\s*\//i);

    const realConnect = ipc.connectProfile.bind(ipc);
    ipc.connectProfile = async (id) => {
      if (id === b.id) throw { kind: "auth", message: "Authentication failed" };
      return realConnect(id);
    };
    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(screen.getByRole("button", { name: /confirm switch/i }));
    await waitFor(() => expect(screen.getByText(/Authentication failed/i)).toBeInTheDocument());
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).toBeDisabled();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(/OK\s*\//i);
  });
});

describe("App wiring regressions after connect (SP-4a)", () => {
  it("reloads columns after FROM commit and clears on start over", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const listColumns = vi.spyOn(ipc, "listColumns");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    await waitFor(() => expect(listColumns).toHaveBeenCalled());
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("where")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.whereColumnPicker));
    expect(screen.getByText(VisualQueryCopy.columnPopoverNeedsFromMessage)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "id" })).toBeNull();
  });

  it("maps columnsError to metadata copy", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("columnsError");
    const happy = createMockDragonIpc("happy");
    ipc.listTables = happy.listTables.bind(happy);
    ipc.listProfiles = happy.listProfiles.bind(happy);
    ipc.saveProfile = happy.saveProfile.bind(happy);
    ipc.connectProfile = happy.connectProfile.bind(happy);
    ipc.disconnect = happy.disconnect.bind(happy);
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    expect(await screen.findByText(VisualQueryCopy.columnsLoadError)).toBeInTheDocument();
  });

  it("maps listTables rejection to metadata copy", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    ipc.listTables = async () => {
      throw new Error("tables unavailable");
    };
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    expect(await screen.findAllByText(VisualQueryCopy.tablesLoadError)).not.toHaveLength(0);
  });

  it("never calls runQuery during canvas editing", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    expect(
      screen.queryByTestId(VisualQueryAccessibility.statementMenuItem("createTable")),
    ).toBeNull();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("wires onRunQuery to ipc.runQuery with live connectionId on SELECT Run", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const runQuery = vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      await gate;
      return {
        columns: ["id"],
        rows: [[1]],
        rowsAffected: null,
        durationMs: 9,
      };
    });
    const listTables = vi.spyOn(ipc, "listTables");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await waitFor(() => expect(listTables).toHaveBeenCalled());
    const connectionId = listTables.mock.calls[0]?.[0];
    expect(connectionId).toBeTruthy();

    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );

    expect(screen.getAllByTestId(VisualQueryAccessibility.runQuery)).toHaveLength(1);
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
    expect(runQuery.mock.calls[0]?.[0]).toBe(connectionId);
    expect(runQuery.mock.calls[0]?.[1]).toEqual(
      expect.objectContaining({
        text: expect.stringMatching(/SELECT/i),
        params: expect.any(Array),
      }),
    );
    await waitFor(() =>
      expect(screen.getByTestId(ResultsAccessibility.loading)).toBeInTheDocument(),
    );
    release();
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    expect(document.querySelector(".vq-canvas__status")?.textContent ?? "").not.toMatch(
      /OK\s*\/\s*1 rows\s*\/\s*9 ms/i,
    );
  });

  it("ignores stale listColumns resolution", async () => {
    const user = userEvent.setup();
    let releaseFirst!: () => void;
    const first = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const ipc = createMockDragonIpc("happy");
    const realColumns = ipc.listColumns.bind(ipc);
    let call = 0;
    let firstReturned = false;
    ipc.listColumns = async (c, table) => {
      call += 1;
      if (call === 1) {
        await first;
        firstReturned = true;
        return [
          {
            name: "stale",
            dataType: "text",
            isNullable: true,
            defaultValue: null,
            isPrimaryKey: false,
            isUnique: false,
            isForeignKey: false,
          },
        ];
      }
      return realColumns(c, table);
    };
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "analytics:events"),
      ),
    );
    await waitFor(() => expect(call).toBe(2));
    releaseFirst();
    await waitFor(() => expect(firstReturned).toBe(true));

    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("where")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.whereColumnPicker));
    expect(await screen.findByRole("button", { name: "event_id" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "stale" })).toBeNull();
  });

  it("invalidates a pending column load when committed FROM clears", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ipc = createMockDragonIpc("happy");
    let loadReturned = false;
    const listColumns = vi.spyOn(ipc, "listColumns").mockImplementation(async () => {
      await pending;
      loadReturned = true;
      return [
        {
          name: "stale",
          dataType: "text",
          isNullable: true,
          defaultValue: null,
          isPrimaryKey: false,
          isUnique: false,
          isForeignKey: false,
        },
      ];
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    await waitFor(() => expect(listColumns).toHaveBeenCalledTimes(1));
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    release();
    await waitFor(() => expect(loadReturned).toBe(true));

    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("where")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.whereColumnPicker));
    expect(screen.getByText(VisualQueryCopy.columnPopoverNeedsFromMessage)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "stale" })).toBeNull();
  });

  it("ignores stale listColumns rejection", async () => {
    const user = userEvent.setup();
    let rejectFirst!: (err: Error) => void;
    const first = new Promise<void>((_resolve, reject) => {
      rejectFirst = reject;
    });
    let settleFirst!: () => void;
    const firstSettled = new Promise<void>((resolve) => {
      settleFirst = resolve;
    });
    const ipc = createMockDragonIpc("happy");
    const realColumns = ipc.listColumns.bind(ipc);
    let call = 0;
    ipc.listColumns = async (c, table) => {
      call += 1;
      if (call === 1) {
        try {
          await first;
          throw new Error("stale rejection");
        } finally {
          settleFirst();
        }
      }
      return realColumns(c, table);
    };
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "analytics:events"),
      ),
    );
    await waitFor(() => expect(call).toBe(2));
    rejectFirst(new Error("stale rejection"));
    await firstSettled;
    await waitFor(() => expect(screen.queryByText(VisualQueryCopy.columnsLoadError)).toBeNull());

    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("where")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.whereColumnPicker));
    expect(await screen.findByRole("button", { name: "event_id" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "stale" })).toBeNull();
  });

  it("does not update state after unmount with pending column load", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const pending = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "listColumns").mockImplementation(async () => {
      await pending;
      return [
        {
          name: "stale",
          dataType: "text",
          isNullable: true,
          defaultValue: null,
          isPrimaryKey: false,
          isUnique: false,
          isForeignKey: false,
        },
      ];
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const unhandled: unknown[] = [];
    const onUnhandled = (event: PromiseRejectionEvent) => {
      unhandled.push(event.reason);
    };
    window.addEventListener("unhandledrejection", onUnhandled);

    const { unmount } = render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    unmount();
    release();
    await waitFor(() => {
      expect(unhandled).toEqual([]);
    });

    const stateUpdateWarnings = consoleError.mock.calls.filter((args) =>
      String(args[0]).includes("Can't perform a React state update on an unmounted component"),
    );
    expect(stateUpdateWarnings).toEqual([]);

    window.removeEventListener("unhandledrejection", onUnhandled);
    consoleError.mockRestore();
  });
});

async function addSelectFromUsers(user: UserEvent): Promise<void> {
  await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
  await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
  await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
  await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
  await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
  await user.click(
    await screen.findByTestId(VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users")),
  );
}

describe("App results pane (SP-4b first slice)", () => {
  it("idle launch with hydrated cachedResultsData shows empty copy, not the grid", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "listTabStates").mockResolvedValue([
      {
        id: "cached-tab",
        connectionId: null,
        databaseName: null,
        queryText: "",
        savedQueryId: null,
        isActive: true,
        order: 0,
        createdAt: "1",
        lastAccessedAt: "1",
        selectedTableSchema: null,
        selectedTableName: null,
        selectedSchemaFilter: null,
        cachedResultsData: JSON.stringify({ columns: ["id"], rows: [["cached"]] }),
        cachedColumnNames: ["id"],
        visualDocumentJson: null,
      },
    ]);
    render(<App ipc={ipc} />);
    expect(await screen.findByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    expect(screen.queryByText("cached")).toBeNull();
  });

  it("failed runQuery shows Query Failed in the results pane and clears prior rows", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    runQuery.mockResolvedValueOnce({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 9,
    });
    runQuery.mockRejectedValueOnce({ kind: "syntax", message: "syntax near x" });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.error)).toBeInTheDocument());
    expect(screen.getByText(ResultsCopy.queryFailedTitle)).toBeInTheDocument();
    expect(screen.getByText("syntax near x")).toBeInTheDocument();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
  });

  it("Start over after results shows empty copy and does not call history deletes", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const deleteHistory = vi.spyOn(ipc, "deleteHistory");
    const clearHistory = vi.spyOn(ipc, "clearHistory");
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 9,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(
      await screen.findByTestId(
        VisualQueryAccessibility.schemaPopoverItem("Tables", "public:users"),
      ),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(await screen.findByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    expect(deleteHistory).not.toHaveBeenCalled();
    expect(clearHistory).not.toHaveBeenCalled();
  });

  it("picker has no CREATE; runQuery is not called without clicking Run on SELECT", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    expect(
      screen.queryByTestId(VisualQueryAccessibility.statementMenuItem("createTable")),
    ).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.statementMenuItem("update"))).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.statementMenuItem("delete"))).toBeNull();
    expect(
      screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")),
    ).toBeInTheDocument();
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("App.tsx puts className app-main-column on the main column and keys only VisualQueryCanvas", () => {
    const src = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(src).toMatch(/className=["']app-main-column["']/);
    expect(src).toMatch(/<VisualQueryCanvas\b/);
    expect(src).toMatch(/key=\{`\$\{activeTabId\}:\$\{docsEpoch\}`\}/);
    expect(src).not.toMatch(/<WorkspaceSplit[^>]*\bkey=\{canvasEpoch\}/);
    expect(src).not.toMatch(/<VisualQueryCanvas[^>]*\bkey=\{canvasEpoch\}/);
    expect(src).not.toMatch(/bumpCanvasEpoch/);
    expect(src).toMatch(/tabDocumentsRef\.current\.get\(activeTabId\)/);
    expect(src).toMatch(/document=\{tabDocument\}/);
    expect(src).not.toMatch(/document=\{tabDocumentsRef\.current\.getOrCreate\(/);
  });

  it("Start over during loading ignores a late runQuery success", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      await gate;
      return { columns: ["id"], rows: [[1]], rowsAffected: null, durationMs: 9 };
    });
    render(
      <div style={{ overflow: "auto", height: "400px" }}>
        <App ipc={ipc} />
      </div>,
    );
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() =>
      expect(screen.getByTestId(ResultsAccessibility.loading)).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(await screen.findByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    release();
    await waitFor(() => {
      expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
        ResultsCopy.runQueryEmpty,
      );
    });
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
  });

  it("late first run does not replace a newer in-flight Run after Start over", async () => {
    const user = userEvent.setup();
    let releaseFirst!: () => void;
    const firstGate = new Promise<void>((r) => {
      releaseFirst = r;
    });
    let releaseSecond!: () => void;
    const secondGate = new Promise<void>((r) => {
      releaseSecond = r;
    });
    const ipc = createMockDragonIpc("happy");
    let call = 0;
    vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        await firstGate;
        return { columns: ["id"], rows: [["first"]], rowsAffected: null, durationMs: 1 };
      }
      await secondGate;
      return { columns: ["id"], rows: [["second"]], rowsAffected: null, durationMs: 2 };
    });
    render(
      <div style={{ overflow: "auto", height: "400px" }}>
        <App ipc={ipc} />
      </div>,
    );
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() =>
      expect(screen.getByTestId(ResultsAccessibility.loading)).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(await screen.findByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(call).toBe(2));
    await waitFor(() =>
      expect(screen.getByTestId(ResultsAccessibility.loading)).toBeInTheDocument(),
    );
    releaseFirst();
    await waitFor(() =>
      expect(screen.getByTestId(ResultsAccessibility.loading)).toBeInTheDocument(),
    );
    expect(screen.queryByText("first")).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    releaseSecond();
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    expect(screen.getByText("second")).toBeInTheDocument();
    expect(screen.queryByText("first")).toBeNull();
  });

  it("Start over during loading ignores a late runQuery failure", async () => {
    const user = userEvent.setup();
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      await gate;
      throw { kind: "syntax", message: "late boom" };
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() =>
      expect(screen.getByTestId(ResultsAccessibility.loading)).toBeInTheDocument(),
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(await screen.findByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    release();
    await waitFor(() => {
      expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
        ResultsCopy.runQueryEmpty,
      );
    });
    expect(screen.queryByTestId(ResultsAccessibility.error)).toBeNull();
    expect(screen.queryByText("late boom")).toBeNull();
  });

  it("disconnect then reconnect same profile after a grid keeps empty copy", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 9,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    await user.click(await screen.findByRole("button", { name: /connect/i }));
    await waitFor(() =>
      expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).not.toBeDisabled(),
    );
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
  });

  it("deleting the SELECT root clears the results pane like Start over", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 9,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    await user.click(screen.getByTestId(VisualQueryAccessibility.deleteClause("select")));
    expect(await screen.findByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
  });

  it("profile switch remounts canvas and dismisses an open SQL dialog while the pane stays empty", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 4,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    await user.click(screen.getByTestId(VisualQueryAccessibility.viewGeneratedSQL));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(await screen.findByRole("button", { name: /confirm switch/i }));
    await waitFor(() =>
      expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument(),
    );
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
  });

  it("incomplete SELECT keeps canRun help on the toolbar, not in the results pane", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    expect(screen.getByText("Choose a table in FROM")).toBeInTheDocument();
    const pane = screen.getByTestId(ResultsAccessibility.pane);
    expect(pane).toHaveTextContent(ResultsCopy.runQueryEmpty);
    expect(pane).not.toHaveTextContent("Choose a table in FROM");
  });
});

describe("App welcome gating", () => {
  it("shows hello and Connect to Server on 0-profile launch and hides the host field", async () => {
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: WelcomeCopy.connectToServer })).toBeInTheDocument();
    expect(screen.getByTestId(WelcomeAccessibility.hello)).toBeInTheDocument();
    expect(screen.queryByLabelText(/host/i)).toBeNull();
  });

  it("Connect to Server shows the form and No connections", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await user.click(await screen.findByRole("button", { name: WelcomeCopy.connectToServer }));
    expect(screen.getByLabelText(/host/i)).toBeInTheDocument();
    expect(screen.queryByText(WelcomeCopy.hello)).toBeNull();
    expect(screen.getByText(ConnectionCopy.noConnections)).toBeInTheDocument();
  });

  it("Cancel with 0 profiles returns welcome and does not save", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saveSpy = vi.spyOn(ipc, "saveProfile");
    render(<App ipc={ipc} />);
    await user.click(await screen.findByRole("button", { name: WelcomeCopy.connectToServer }));
    await user.type(screen.getByLabelText(/host/i), "127.0.0.1");
    await user.click(screen.getByRole("button", { name: ConnectionCopy.cancel }));
    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
    expect(screen.queryByLabelText(/host/i)).toBeNull();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("does not show welcome when a saved profile exists on launch", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    expect(await screen.findByLabelText(/host/i)).toBeInTheDocument();
    expect(screen.queryByText(WelcomeCopy.hello)).toBeNull();
  });

  it("returns welcome after the last profile is deleted", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    await user.click(await screen.findByRole("button", { name: /^dev$/i }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.delete }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.confirmDelete }));
    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
    expect(screen.queryByLabelText(/host/i)).toBeNull();
  });

  it("Cancel on a dirty New profile form with existing profiles does not show welcome or save", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    const saveSpy = vi.spyOn(ipc, "saveProfile");
    render(<App ipc={ipc} />);
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.newProfile }));
    await user.type(screen.getByLabelText(/host/i), "other-host");
    saveSpy.mockClear();
    await user.click(screen.getByRole("button", { name: ConnectionCopy.cancel }));
    expect(screen.queryByText(WelcomeCopy.hello)).toBeNull();
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).toBeInTheDocument();
    expect(saveSpy).not.toHaveBeenCalled();
  });

  it("does not commit welcome or workspace until initial listProfiles resolves to 0", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ipc = createMockDragonIpc("happy");
    const realList = ipc.listProfiles.bind(ipc);
    ipc.listProfiles = async () => {
      await gate;
      return realList();
    };
    render(<App ipc={ipc} />);
    expect(screen.queryByText(WelcomeCopy.hello)).toBeNull();
    expect(screen.queryByLabelText(/host/i)).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.initialAddBlock)).toBeNull();
    release();
    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
    expect(screen.queryByLabelText(/host/i)).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.initialAddBlock)).toBeNull();
  });

  it("shows only a neutral aria-busy startup shell while initial listProfiles is pending", async () => {
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const ipc = createMockDragonIpc("happy");
    const realList = ipc.listProfiles.bind(ipc);
    ipc.listProfiles = async () => {
      await gate;
      return realList();
    };
    render(<App ipc={ipc} />);
    const busy = document.querySelector("main[aria-busy='true']");
    expect(busy).not.toBeNull();
    expect(screen.queryByText(WelcomeCopy.hello)).toBeNull();
    expect(screen.queryByLabelText(/host/i)).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.initialAddBlock)).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.runQuery)).toBeNull();
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByRole("button", { name: /queries/i })).toBeNull();
    release();
    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
  });
});

describe("App tab bar and in-session documents", () => {
  it("New Tab creates an empty canvas and idle results while keeping tab 1 cards and the connection", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    expect(screen.getByTestId(TabBarAccessibility.strip)).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).not.toBeDisabled();
    await user.click(screen.getAllByRole("tab")[0]!);
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("from"))).toBeInTheDocument();
  });

  it("background Run does not mark tab 2 loading and restores tab 1 rows on switch back", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    let releaseRun!: () => void;
    const runGate = new Promise<void>((resolve) => {
      releaseRun = resolve;
    });
    vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      await runGate;
      return { columns: ["id"], rows: [[1], [2]], rowsAffected: null, durationMs: 4 };
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    expect(screen.queryByTestId(ResultsAccessibility.loading)).toBeNull();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    releaseRun();
    await user.click(screen.getAllByRole("tab")[0]!);
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("from"))).toBeInTheDocument();
  });

  it("Start over clears only the active tab cards and grid", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getAllByRole("tab")[0]!);
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    await user.click(screen.getAllByRole("tab")[1]!);
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
  });

  it("disconnect keeps active-tab cards and locks mutate/Run", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock)).toBeDisabled();
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
  });

  it("profile switch empties every tab's cards and grids", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(await screen.findByRole("button", { name: /connect/i }));
    await waitFor(() =>
      expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument(),
    );
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    await user.click(screen.getAllByRole("tab")[0]!);
    expect(screen.queryByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeNull();
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
  });

  it("delete last profile while disconnected then connect a new profile starts with empty cards", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("from"))).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ConnectionCopy.delete }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.confirmDelete }));
    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: WelcomeCopy.connectToServer }));
    await user.type(screen.getByLabelText(/host/i), "127.0.0.1");
    await user.type(screen.getByLabelText(/username/i), "postgres");
    await user.type(screen.getByLabelText(/database/i), "app");
    await user.type(screen.getByLabelText(/^password$/i), "pw");
    await user.click(screen.getByRole("button", { name: /save/i }));
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connectNow }));
    await waitFor(() =>
      expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).not.toBeDisabled(),
    );
    expect(screen.queryByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeNull();
    expect(screen.queryByTestId(VisualQueryAccessibility.clauseCard("from"))).toBeNull();
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
  });

  it("closing the last tab recreates an empty tab with empty canvas and grid", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(TabBarAccessibility.closeTab));
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByTestId(TabBarAccessibility.strip)).toBeNull();
  });

  it("closing an inactive tab among three leaves the active tab cards in place", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    await user.click(screen.getAllByRole("tab")[1]!);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    const closeButtons = screen.getAllByRole("button", { name: /close tab/i });
    await user.click(closeButtons[0]!);
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
  });
});

function savedQuery(id: string, name: string, queryText: string): SavedQueryDto {
  return {
    id,
    name,
    queryText,
    connectionId: null,
    databaseName: null,
    createdAt: "1",
    updatedAt: "1",
    folderId: null,
  };
}

describe("App Queries column (SP-4b)", () => {
  it("shows Queries left of the canvas in the workspace including disconnected, and hides it on welcome", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    expect(screen.queryByTestId(QueriesAccessibility.column)).toBeNull();
    await user.click(await screen.findByRole("button", { name: WelcomeCopy.connectToServer }));
    expect(screen.getByTestId(QueriesAccessibility.column)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ConnectionCopy.cancel }));
    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
    expect(screen.queryByTestId(QueriesAccessibility.column)).toBeNull();
  });

  it("does not persist the Queries split layout", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    render(<App ipc={ipc} />);
    expect(await screen.findByTestId(QueriesAccessibility.column)).toBeInTheDocument();
    expect(setItem).not.toHaveBeenCalled();
    setItem.mockRestore();
  });

  it("clicking Q1 restores B′ grid rows without rebuilding visual cards from Q1 SQL", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const library = [
      savedQuery("q1", "Q1", "SELECT * FROM other"),
      savedQuery("q2", "Q2", "SELECT 2"),
    ];
    vi.spyOn(ipc, "listSavedQueries").mockImplementation(async () => library.slice());
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: Array.from({ length: 10 }, (_, i) => [i]),
      rowsAffected: null,
      durationMs: 8,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Q2" }));
    await user.click(screen.getByRole("button", { name: "Q1" }));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("from"))).toBeInTheDocument();
    expect(screen.queryByText("other")).toBeNull();
    expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.grid).querySelectorAll("tbody tr")).toHaveLength(
      10,
    );
  });

  it("a failed Run while Q1 is selected does not overwrite the last success cache", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "listSavedQueries").mockResolvedValue([
      savedQuery("q1", "Q1", "SELECT 1"),
      savedQuery("q2", "Q2", "SELECT 2"),
    ]);
    const runQuery = vi.spyOn(ipc, "runQuery");
    runQuery.mockResolvedValueOnce({
      columns: ["id"],
      rows: [[1], [2]],
      rowsAffected: null,
      durationMs: 3,
    });
    runQuery.mockRejectedValueOnce({ kind: "syntax", message: "boom" });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.error)).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: "Q2" }));
    await user.click(screen.getByRole("button", { name: "Q1" }));
    expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument();
    expect(screen.queryByTestId(ResultsAccessibility.error)).toBeNull();
  });

  it("profile switch drops B′ so clicking Q1 does not refill profile A rows", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "listSavedQueries").mockResolvedValue([savedQuery("q1", "Q1", "SELECT 1")]);
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: [["from-a"]],
      rowsAffected: null,
      durationMs: 2,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByText("from-a")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(await screen.findByRole("button", { name: /connect/i }));
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    expect(screen.queryByText("from-a")).toBeNull();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
  });

  it("profile switch empties the grid even if Q1 restored B′ after disconnect", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: {
        name: "B",
        host: "db-b",
        port: 5432,
        username: "postgres",
        database: "app",
        isFavorite: false,
        sslMode: "prefer",
        sshEnabled: false,
        sshHost: null,
        sshPort: null,
        sshUsername: null,
        sshAuthMethod: null,
        sshPrivateKeyPath: null,
      },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "listSavedQueries").mockResolvedValue([savedQuery("q1", "Q1", "SELECT 1")]);
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: [["from-a"]],
      rowsAffected: null,
      durationMs: 2,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByText("from-a")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await user.click(screen.getByRole("button", { name: "Q1" }));
    expect(screen.getByText("from-a")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(await screen.findByRole("button", { name: /connect/i }));
    await waitFor(() =>
      expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument(),
    );
    expect(screen.queryByText("from-a")).toBeNull();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
  });

  it("selecting uncached Q2 clears Q1 rows and ignores a Run started before the switch", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const library = [savedQuery("q1", "Q1", "SELECT 1"), savedQuery("q2", "Q2", "SELECT 2")];
    vi.spyOn(ipc, "listSavedQueries").mockImplementation(async () => library.slice());
    let release!: () => void;
    const gate = new Promise<void>((r) => {
      release = r;
    });
    let call = 0;
    vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      call += 1;
      if (call === 1) {
        return {
          columns: ["id"],
          rows: Array.from({ length: 10 }, (_, i) => [`q1-${i}`]),
          rowsAffected: null,
          durationMs: 8,
        };
      }
      await gate;
      return { columns: ["id"], rows: [["late-q1"]], rowsAffected: null, durationMs: 9 };
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
    expect(screen.getByTestId(ResultsAccessibility.grid).querySelectorAll("tbody tr")).toHaveLength(
      10,
    );
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() =>
      expect(screen.getByTestId(ResultsAccessibility.loading)).toBeInTheDocument(),
    );
    await user.click(screen.getByRole("button", { name: "Q2" }));
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    expect(screen.queryByText("q1-0")).toBeNull();
    release();
    await waitFor(() => {
      expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
        ResultsCopy.runQueryEmpty,
      );
    });
    expect(screen.queryByText("late-q1")).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    await user.click(screen.getByRole("button", { name: "Q2" }));
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.queryByText("late-q1")).toBeNull();
  });

  it("Queries + selects a new Query yy-MM-dd H:mm:ss and clears the active canvas and grid", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const library = [savedQuery("q1", "Q1", "SELECT 1")];
    vi.spyOn(ipc, "listSavedQueries").mockImplementation(async () => library.slice());
    vi.spyOn(ipc, "saveSavedQuery").mockImplementation(async (query) => {
      library.push(query);
      return query;
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(screen.getByTestId(VisualQueryAccessibility.allColumnsToggle));
    await user.click(screen.getByTestId(VisualQueryAccessibility.selectColumnsPicker));
    expect(
      await screen.findByTestId(VisualQueryAccessibility.schemaPopoverItem("Columns", "id")),
    ).toBeInTheDocument();
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    await user.click(screen.getByTestId(QueriesAccessibility.newQuery));
    expect(screen.getByText(/^Query \d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/)).toBeInTheDocument();
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(QueriesCopy.empty).toBe("No saved queries");
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.allColumnsToggle));
    await user.click(screen.getByTestId(VisualQueryAccessibility.selectColumnsPicker));
    expect(
      screen.queryByTestId(VisualQueryAccessibility.schemaPopoverItem("Columns", "id")),
    ).toBeNull();
    expect(screen.queryByRole("button", { name: "id" })).toBeNull();
  });

  it("Queries + clears the tab that was active when + was clicked even if the user switches tabs during save", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const library = [savedQuery("q1", "Q1", "SELECT 1")];
    vi.spyOn(ipc, "listSavedQueries").mockImplementation(async () => library.slice());
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(ipc, "saveSavedQuery").mockImplementation(async (query) => {
      await gate;
      library.push(query);
      return query;
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    await user.click(screen.getByTestId(QueriesAccessibility.newQuery));
    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    release();
    expect(
      await screen.findByText(/^Query \d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/),
    ).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();
    await user.click(screen.getAllByRole("tab")[0]!);
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(
      screen.getByRole("button", { name: /^Query \d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });
});

describe("App native menu and accelerators (SP-4b)", () => {
  it("Accel+T creates a second tab in the workspace", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    await screen.findByTestId(TabBarAccessibility.newTab);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true, bubbles: true }));
    expect(await screen.findByTestId(TabBarAccessibility.strip)).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
  });

  it("Accel+Enter does not call runQuery when Run is disabled", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await screen.findByTestId(VisualQueryAccessibility.runQuery);
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("Accel+Enter runs the active runnable SELECT exactly once", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
  });

  it("Accel+W closes the active tab when two tabs are open", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    await screen.findByTestId(TabBarAccessibility.newTab);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true, bubbles: true }));
    expect(await screen.findByTestId(TabBarAccessibility.strip)).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "w", ctrlKey: true, bubbles: true }));
    await waitFor(() => expect(screen.queryByTestId(TabBarAccessibility.strip)).toBeNull());
  });

  it("native menu new-tab and close-tab drive the same dispatcher as accelerators", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    render(<App ipc={ipc} />);
    await screen.findByTestId(TabBarAccessibility.newTab);
    emitTauriMenuForTest("new-tab");
    expect(await screen.findByTestId(TabBarAccessibility.strip)).toBeInTheDocument();
    expect(screen.getAllByRole("tab")).toHaveLength(2);
    emitTauriMenuForTest("close-tab");
    await waitFor(() => expect(screen.queryByTestId(TabBarAccessibility.strip)).toBeNull());
  });

  it("native menu run-query runs a SELECT once and no-ops when Run is disabled", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await screen.findByTestId(VisualQueryAccessibility.runQuery);
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    emitTauriMenuForTest("run-query");
    expect(runQuery).not.toHaveBeenCalled();
    await connectFirst(user, ipc);
    await addSelectFromUsers(user);
    emitTauriMenuForTest("run-query");
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId(ResultsAccessibility.grid)).toBeInTheDocument());
  });

  it("welcome ignores Accel+T and still opens Help from the menu handler", async () => {
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
    window.dispatchEvent(new KeyboardEvent("keydown", { key: "t", ctrlKey: true, bubbles: true }));
    expect(screen.queryByTestId(TabBarAccessibility.strip)).toBeNull();
    emitTauriMenuForTest("help");
    expect(await screen.findByRole("dialog", { name: HelpCopy.helpTitle })).toBeInTheDocument();
    expect(screen.getByTestId(HelpAccessibility.done)).toBeInTheDocument();
  });

  it("Settings date format radio survives remount via localStorage", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    const { unmount } = render(<App ipc={ipc} />);
    emitTauriMenuForTest("settings");
    await user.click(await screen.findByLabelText(HelpCopy.dateFormatEuropean));
    unmount();
    render(<App ipc={ipc} />);
    emitTauriMenuForTest("settings");
    expect(await screen.findByLabelText(HelpCopy.dateFormatEuropean)).toBeChecked();
  });
});

describe("App overlay, collapse, and title (SP-4b last slice T6)", () => {
  it("collapse hides Connection and keeps Queries | canvas; title follows picker", async () => {
    const ipc = createMockDragonIpc("happy");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    expect(screen.getByText(ConnectionCopy.panelTitle)).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ConnectionCopy.collapseConnection }));
    expect(screen.queryByText(ConnectionCopy.panelTitle)).toBeNull();
    expect(screen.getByTestId(QueriesAccessibility.column)).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).toBeInTheDocument();
  });

  it("window title follows the selected database", async () => {
    const ipc = createMockDragonIpc("happy");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    expect(document.title).toBe("app");
  });

  it("launch connect failure ends overlay and shows Connection Error", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "connectProfile").mockRejectedValueOnce({
      kind: "connection",
      message: "refused",
    });
    render(<App ipc={ipc} />);
    expect(await screen.findByText(/Connection Error/i)).toBeInTheDocument();
    expect(screen.queryByText(/Initializing/)).toBeNull();
  });
});
