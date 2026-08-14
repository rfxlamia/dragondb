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

import type { UserEvent } from "@testing-library/user-event";
import App from "../../src/App";
import type { DragonIpc } from "../../src/ipc/contract";
import { createMockDragonIpc, FIXTURE_CONNECTION_ID } from "../../src/ipc/mock";
import { ResultsAccessibility } from "../../src/ui/results/results-accessibility";
import { ResultsCopy } from "../../src/ui/results/results-copy";
import { VisualQueryAccessibility } from "../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../src/ui/visual-query/copy";

afterEach(() => cleanup());

async function connectFirst(user: UserEvent, _ipc: DragonIpc): Promise<void> {
  await user.type(screen.getByLabelText(/host/i), "127.0.0.1");
  await user.type(screen.getByLabelText(/username/i), "postgres");
  await user.type(screen.getByLabelText(/database/i), "app");
  await user.type(screen.getByLabelText(/^password$/i), "pw");
  await user.click(screen.getByRole("button", { name: /save/i }));
  await user.click(await screen.findByRole("button", { name: /connect/i }));
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
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    expect(screen.queryByTestId(VisualQueryAccessibility.initialAddBlock)).toBeDisabled();
    expect(screen.queryByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    expect(screen.getAllByTestId(VisualQueryAccessibility.runQuery)).toHaveLength(1);
  });

  it("Phase C must not render TabBar / History browser / Export button", async () => {
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    expect(screen.queryByRole("tablist")).toBeNull();
    expect(screen.queryByText(/history/i)).toBeNull();
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
    await user.click(await screen.findByRole("button", { name: "users" }));

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
    await user.click(await screen.findByRole("button", { name: "users" }));
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
    await user.click(await screen.findByRole("button", { name: "users" }));
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
    await user.click(await screen.findByRole("button", { name: "users" }));
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
    await user.click(await screen.findByRole("button", { name: "users" }));
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
    expect(await screen.findByText(VisualQueryCopy.tablesLoadError)).toBeInTheDocument();
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
    await user.click(await screen.findByRole("button", { name: "users" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    await user.click(screen.getByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("createTable")));
    await user.type(screen.getByTestId(VisualQueryAccessibility.createTableNameField), "orders");
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
    await user.click(await screen.findByRole("button", { name: "users" }));

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
    await user.click(await screen.findByRole("button", { name: "users" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(await screen.findByRole("button", { name: "analytics.events" }));
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
    await user.click(await screen.findByRole("button", { name: "users" }));
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
    await user.click(await screen.findByRole("button", { name: "users" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(await screen.findByRole("button", { name: "analytics.events" }));
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
    await user.click(await screen.findByRole("button", { name: "users" }));
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
  await user.click(await screen.findByRole("button", { name: "users" }));
}

describe("App results pane (SP-4b first slice)", () => {
  it("idle launch with hydrated cachedResultsData shows empty copy, not the grid", async () => {
    const ipc = createMockDragonIpc("happy");
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
    await user.click(await screen.findByRole("button", { name: "users" }));
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
    await user.click(await screen.findByRole("button", { name: "users" }));
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

  it("CREATE disables Run in App so runQuery is not called", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("createTable")));
    await user.type(screen.getByTestId(VisualQueryAccessibility.createTableNameField), "orders");
    await user.type(screen.getByTestId(VisualQueryAccessibility.createColumnNameField(0)), "id");
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).toBeDisabled();
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    expect(runQuery).not.toHaveBeenCalled();
  });

  it("App.tsx puts className app-main-column on the main column and keys only VisualQueryCanvas", () => {
    const src = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(src).toMatch(/className=["']app-main-column["']/);
    expect(src).toMatch(/<VisualQueryCanvas\b/);
    expect(src).toMatch(/key=\{canvasEpoch\}/);
    expect(src).not.toMatch(/<WorkspaceSplit[^>]*\bkey=\{canvasEpoch\}/);
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
});
