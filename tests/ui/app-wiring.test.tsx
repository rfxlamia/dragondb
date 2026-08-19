/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
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
import { QueryDocument } from "../../src/core";
import type { DragonIpc, QueryResult, SavedQueryDto, TabStateDto } from "../../src/ipc/contract";
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
import { SidebarAccessibility } from "../../src/ui/shell/sidebar-accessibility";
import { SidebarCopy } from "../../src/ui/shell/sidebar-copy";
import { TabBarAccessibility } from "../../src/ui/shell/tab-bar-accessibility";
import type { MenuEventId } from "../../src/ui/shell/workspace-accelerators";
import { SqlHatchCopy } from "../../src/ui/sql-editor/sql-hatch-copy";
import { TablesCopy } from "../../src/ui/tables/tables-copy";
import { VisualQueryAccessibility } from "../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../src/ui/visual-query/copy";
import { serializeQueryDocument } from "../../src/ui/visual-query/tab-documents";
import { WelcomeAccessibility } from "../../src/ui/welcome/welcome-accessibility";
import { WelcomeCopy } from "../../src/ui/welcome/welcome-copy";
import { defined } from "../lib/defined";

function emitTauriMenuForTest(id: MenuEventId): void {
  menuListen.emit(id);
}

function getSidebarSwitcher(): HTMLElement {
  return screen.getByTestId(SidebarAccessibility.switcher);
}

function getSidebarTabInput(tab: "schema" | "queries"): HTMLInputElement {
  const label = tab === "schema" ? SidebarCopy.schemaTab : SidebarCopy.queriesTab;
  return within(getSidebarSwitcher()).getByLabelText(label) as HTMLInputElement;
}

async function clickSidebarTab(user: UserEvent, tab: "schema" | "queries"): Promise<void> {
  await user.click(getSidebarTabInput(tab));
}

function getSchemaTabPanel(): HTMLElement {
  const panel = document.getElementById("sidebar-tabpanel-schema");
  if (panel === null) {
    throw new Error("schema tab panel not found");
  }
  return panel;
}

function getQueriesTabPanel(): HTMLElement {
  const panel = document.getElementById("sidebar-tabpanel-queries");
  if (panel === null) {
    throw new Error("queries tab panel not found");
  }
  return panel;
}

function getWorkspaceTabStrip(): HTMLElement | null {
  return screen.queryByTestId(TabBarAccessibility.strip);
}

function getWorkspaceTabs(): HTMLElement[] {
  const strip = getWorkspaceTabStrip();
  if (strip === null) return [];
  return within(strip).getAllByRole("tab");
}

function clickWorkspaceTab(user: UserEvent, index: number): Promise<void> {
  return user.click(defined(getWorkspaceTabs()[index], `expected workspace tab ${index}`));
}

afterEach(() => {
  cleanup();
  menuListen.reset();
  localStorage.clear();
});

/**
 * Connect the fixture profile, then (by default) select "app" from the
 * Catalog picker so the session ends up connected WITH a database chosen —
 * the normal baseline for Run-success assertions. `user.type` on the
 * individual-fields form does not reliably land under the full App tree
 * (a pre-existing, out-of-scope issue independent of T12), so the profile's
 * typed database can't be trusted; selecting it explicitly via the picker
 * (which does work reliably) is what actually establishes databaseName.
 * Pass `{ selectDatabase: false }` for tests that need the connected+no-db
 * state (decision 14's alert path) instead.
 */
function profileListRows(): HTMLElement[] {
  return Array.from(
    document.querySelectorAll<HTMLElement>(".connection-panel__profiles button.ui-row"),
  );
}

async function openNewConnectionSheet(user: UserEvent): Promise<void> {
  const newProfile = screen.queryByRole("button", { name: ConnectionCopy.newProfile });
  if (newProfile) {
    await user.click(newProfile);
  }
  await screen.findByRole("dialog", { name: ConnectionCopy.formTitleNew });
}

async function drainRestoreLeftovers(user: UserEvent): Promise<void> {
  await waitFor(() => expect(document.querySelector(".loading-overlay")).toBeNull());
  const disconnect = screen.queryByRole("button", { name: ConnectionCopy.disconnect });
  if (disconnect) {
    await user.click(disconnect);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: ConnectionCopy.disconnect })).toBeNull(),
    );
  }
}

async function connectFirst(
  user: UserEvent,
  _ipc: DragonIpc,
  options: { selectDatabase?: boolean; queriesTab?: boolean } = {},
): Promise<void> {
  await waitFor(() => {
    expect(
      screen.queryByRole("button", { name: WelcomeCopy.connectToServer }) ??
        screen.queryByLabelText(/host/i),
    ).not.toBeNull();
  });
  const connectToServer = screen.queryByRole("button", { name: WelcomeCopy.connectToServer });
  if (connectToServer) {
    await user.click(connectToServer);
  } else {
    await waitFor(() => expect(profileListRows().length).toBeGreaterThan(0));
  }

  if (profileListRows().length > 0) {
    await openNewConnectionSheet(user);
    await drainRestoreLeftovers(user);
    if (screen.queryByRole("dialog", { name: ConnectionCopy.formTitleEdit })) {
      await openNewConnectionSheet(user);
    } else {
      await screen.findByRole("dialog", { name: ConnectionCopy.formTitleNew });
    }
  } else {
    const newProfile = screen.queryByRole("button", { name: ConnectionCopy.newProfile });
    if (newProfile) {
      await user.click(newProfile);
    }
    await screen.findByRole("dialog", { name: ConnectionCopy.formTitleNew });
  }

  await user.type(screen.getByLabelText(/host/i), "127.0.0.1");
  await user.type(screen.getByLabelText(/username/i), "postgres");
  const databaseField = screen.getByLabelText(ConnectionCopy.database);
  await user.type(databaseField, "app");
  if (options.selectDatabase ?? true) {
    fireEvent.change(databaseField, { target: { value: "app" } });
  }
  await user.type(screen.getByLabelText(/^password$/i), "pw");
  await user.click(screen.getByRole("button", { name: /save/i }));
  await user.click(await screen.findByRole("button", { name: ConnectionCopy.connectNow }));
  await waitFor(() =>
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).not.toBeDisabled(),
  );
  if (options.selectDatabase ?? true) {
    const picker = screen.queryByLabelText(ConnectionCopy.catalog);
    if (picker) {
      await user.selectOptions(picker, "app");
    }
  }
  const profileB = screen.queryByRole("button", { name: /^B$/i });
  if (profileB) {
    expect(profileB).not.toHaveClass("ui-row--selected");
  }
  if (options.queriesTab) {
    await clickSidebarTab(user, "queries");
  }
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
    // No database selection here — switching database reloads tables and
    // would make listTables' call count no longer reflect connect alone.
    await connectFirst(user, ipc, { selectDatabase: false });

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

  it("disables the rail toggle and tab switcher while the connection form is open", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await user.click(await screen.findByRole("button", { name: WelcomeCopy.connectToServer }));

    const toggle = screen.getByTestId(ConnectionAccessibility.collapseConnection);
    expect((toggle as HTMLButtonElement).disabled).toBe(true);
    expect(getSidebarTabInput("schema").disabled).toBe(true);
    expect(getSidebarTabInput("queries").disabled).toBe(true);

    await user.click(screen.getByRole("button", { name: ConnectionCopy.cancel }));

    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
  });

  it("reaches the saved-queries list through the sidebar's Queries tab", async () => {
    const ipc = createMockDragonIpc("happy");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    expect(
      within(getSchemaTabPanel()).getByTestId(ConnectionAccessibility.tablesRegion),
    ).toBeInTheDocument();
    expect(getQueriesTabPanel().hidden).toBe(true);

    await clickSidebarTab(user, "queries");

    expect(
      within(getQueriesTabPanel()).getByTestId(QueriesAccessibility.column),
    ).toBeInTheDocument();
    expect(getSchemaTabPanel().hidden).toBe(true);
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connect }));
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connect }));
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.confirmSwitch }));
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.confirmSwitch }));
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.confirmSwitch }));
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.confirmSwitch }));
    await waitFor(() => expect(screen.getByText(/Authentication failed/i)).toBeInTheDocument());
    expect(screen.getByTestId(VisualQueryAccessibility.clauseCard("select"))).toBeInTheDocument();

    failB = false;
    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connect }));
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
    expect(screen.queryByTestId(TabBarAccessibility.strip)).toBeNull();
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.confirmSwitch }));
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

  it("cancels SQL hatch after 3s with Query cancelled status and cleared results", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runQuery = vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      await gate;
      return {
        columns: ["n"],
        rows: [[99]],
        rowsAffected: null,
        durationMs: 12,
      };
    });
    const cancelQuery = vi.spyOn(ipc, "cancelQuery").mockResolvedValue(undefined);
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.selectOptions(screen.getByLabelText("Catalog"), "app");
    await waitFor(() => expect(document.title).toBe("app"));
    await user.click(screen.getByRole("radio", { name: /sql/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "SQL editor" }), {
      target: { value: "SELECT pg_sleep(10)" },
    });

    vi.useFakeTimers();
    try {
      const timerUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      fireEvent.click(screen.getByRole("button", { name: SqlHatchCopy.run }));
      await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
      expect(screen.getByTestId(ResultsAccessibility.loading)).toBeInTheDocument();
      await vi.advanceTimersByTimeAsync(3001);
      await timerUser.keyboard("{Escape}");
    } finally {
      vi.useRealTimers();
    }

    expect(cancelQuery).toHaveBeenCalledTimes(1);
    expect(screen.getByText(SqlHatchCopy.queryCancelled)).toBeInTheDocument();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.loading)).toBeNull();
    release();
    await waitFor(() => {
      expect(screen.getByText(SqlHatchCopy.queryCancelled)).toBeInTheDocument();
      expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    });
  });

  it("runs SQL hatch SELECT and mutation from the synced active-tab buffer", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.selectOptions(screen.getByLabelText("Catalog"), "app");
    await waitFor(() => expect(document.title).toBe("app"));

    await user.click(screen.getByRole("radio", { name: /sql/i }));
    const editor = screen.getByRole("textbox", { name: "SQL editor" });
    fireEvent.change(editor, { target: { value: "SELECT 1 AS n" } });
    expect(editor).toHaveValue("SELECT 1 AS n");
    await user.click(document.querySelector(".sql-hatch__run") as HTMLButtonElement);
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({ text: "SELECT 1 AS n" });

    fireEvent.change(editor, { target: { value: "UPDATE users SET name = 'Ada' WHERE false" } });
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(2));
    expect(runQuery.mock.calls[1]?.[1]).toMatchObject({
      text: "UPDATE users SET name = 'Ada' WHERE false",
    });
  });

  it("auto-creates and selects a SavedQuery after hatch typing is debounced", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const savedQueries: SavedQueryDto[] = [];
    vi.spyOn(ipc, "listSavedQueries").mockImplementation(async () => [...savedQueries]);
    const saveSavedQuery = vi.spyOn(ipc, "saveSavedQuery").mockImplementation(async (query) => {
      savedQueries.push(query);
      return query;
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc, { queriesTab: true });
    await user.selectOptions(screen.getByLabelText("Catalog"), "app");
    await user.click(screen.getByRole("radio", { name: /sql/i }));

    fireEvent.change(screen.getByRole("textbox", { name: "SQL editor" }), {
      target: { value: "SELECT 42" },
    });

    await waitFor(() => expect(saveSavedQuery).toHaveBeenCalledTimes(1), { timeout: 1_500 });
    const created = saveSavedQuery.mock.calls[0]?.[0];
    if (created === undefined) throw new Error("Expected an auto-created SavedQuery");
    expect(created.queryText).toBe("SELECT 42");
    expect(await screen.findByRole("button", { name: created.name })).toHaveAttribute(
      "aria-pressed",
      "true",
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connect }));
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.confirmSwitch }));
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
    expect(screen.queryByTestId(TabBarAccessibility.strip)).toBeNull();
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
    expect(getWorkspaceTabs()).toHaveLength(2);
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).not.toBeDisabled();
    await clickWorkspaceTab(user, 0);
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
    await clickWorkspaceTab(user, 0);
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
    await clickWorkspaceTab(user, 0);
    await user.click(screen.getByTestId(VisualQueryAccessibility.startOver));
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    await clickWorkspaceTab(user, 1);
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
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connect }));
    await waitFor(() =>
      expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument(),
    );
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    await clickWorkspaceTab(user, 0);
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
    expect(getWorkspaceTabs()).toHaveLength(3);
    await clickWorkspaceTab(user, 1);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    const closeButtons = screen.getAllByRole("button", { name: /close tab/i });
    await user.click(defined(closeButtons[0], "expected first close tab button"));
    expect(getWorkspaceTabs()).toHaveLength(2);
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
  it("shows Queries in the sidebar Queries tab when connected, and hides it on welcome", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    expect(screen.queryByTestId(QueriesAccessibility.column)).toBeNull();
    await user.click(await screen.findByRole("button", { name: WelcomeCopy.connectToServer }));
    expect(getQueriesTabPanel().hidden).toBe(true);
    await user.click(screen.getByRole("button", { name: ConnectionCopy.cancel }));
    expect(await screen.findByText(WelcomeCopy.hello)).toBeInTheDocument();
    expect(screen.queryByTestId(QueriesAccessibility.column)).toBeNull();
    await connectFirst(user, ipc, { queriesTab: true });
    expect(
      within(getQueriesTabPanel()).getByTestId(QueriesAccessibility.column),
    ).toBeInTheDocument();
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
    await connectFirst(user, ipc, { queriesTab: true });
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
    await connectFirst(user, ipc, { queriesTab: true });
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
    await connectFirst(user, ipc, { queriesTab: true });
    await addSelectFromUsers(user);
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByText("from-a")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connect }));
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
    await connectFirst(user, ipc, { queriesTab: true });
    await addSelectFromUsers(user);
    await user.click(await screen.findByRole("button", { name: "Q1" }));
    await user.click(screen.getByTestId(VisualQueryAccessibility.runQuery));
    await waitFor(() => expect(screen.getByText("from-a")).toBeInTheDocument());
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    await user.click(screen.getByRole("button", { name: "Q1" }));
    expect(screen.getByText("from-a")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /^B$/i }));
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connect }));
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
    await connectFirst(user, ipc, { queriesTab: true });
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
    await connectFirst(user, ipc, { queriesTab: true });
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
    await connectFirst(user, ipc, { queriesTab: true });
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
    await clickWorkspaceTab(user, 0);
    expect(screen.getByText(VisualQueryCopy.emptyCanvasTitle)).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.empty)).toHaveTextContent(
      ResultsCopy.runQueryEmpty,
    );
    expect(
      screen.getByRole("button", { name: /^Query \d{2}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/ }),
    ).toHaveAttribute("aria-pressed", "true");
  });

  it("selecting Q1 loads its SQL into the hatch buffer, and switching to Q2 mid-debounce does not clobber Q1's saved text", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const library = [savedQuery("q1", "Q1", "SELECT 1"), savedQuery("q2", "Q2", "SELECT 2")];
    vi.spyOn(ipc, "listSavedQueries").mockImplementation(async () => library.slice());
    vi.spyOn(ipc, "saveSavedQuery").mockImplementation(async (query) => {
      const idx = library.findIndex((item) => item.id === query.id);
      if (idx >= 0) library[idx] = query;
      else library.push(query);
      return query;
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc, { queriesTab: true });
    await user.click(screen.getByRole("radio", { name: /sql/i }));

    await user.click(await screen.findByRole("button", { name: "Q1" }));
    const editor = screen.getByRole("textbox", { name: "SQL editor" });
    expect(editor).toHaveValue("SELECT 1");

    fireEvent.change(editor, { target: { value: "SELECT 1 -- edited" } });
    await user.click(screen.getByRole("button", { name: "Q2" }));
    expect(editor).toHaveValue("SELECT 2");

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 700));
    });

    expect(library.find((item) => item.id === "q1")?.queryText).toBe("SELECT 1");
    expect(library.find((item) => item.id === "q2")?.queryText).toBe("SELECT 2");
  });

  it("re-clicking the already-selected query keeps unsaved hatch edits instead of reloading disk text", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const library = [savedQuery("q1", "Q1", "SELECT 1")];
    vi.spyOn(ipc, "listSavedQueries").mockImplementation(async () => library.slice());
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc, { queriesTab: true });
    await user.click(screen.getByRole("radio", { name: /sql/i }));

    await user.click(await screen.findByRole("button", { name: "Q1" }));
    const editor = screen.getByRole("textbox", { name: "SQL editor" });
    expect(editor).toHaveValue("SELECT 1");

    fireEvent.change(editor, { target: { value: "SELECT 1 -- edited" } });
    await user.click(screen.getByRole("button", { name: "Q1" }));
    expect(editor).toHaveValue("SELECT 1 -- edited");
  });

  it("sidebar Refresh applies the re-fetched database list to the connection picker", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const listDatabases = vi.spyOn(ipc, "listDatabases").mockResolvedValue(["app"]);
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc, { queriesTab: true });

    const picker = screen.getByLabelText("Catalog") as HTMLSelectElement;
    expect(Array.from(picker.options).map((option) => option.value)).toContain("app");
    expect(Array.from(picker.options).map((option) => option.value)).not.toContain("shop");

    listDatabases.mockResolvedValue(["app", "shop"]);
    await user.click(screen.getByRole("button", { name: QueriesCopy.refresh }));
    await waitFor(() => expect(listDatabases).toHaveBeenCalledTimes(2));
    await waitFor(() =>
      expect(Array.from(picker.options).map((option) => option.value)).toContain("shop"),
    );
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
    expect(getWorkspaceTabs()).toHaveLength(2);
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
    await connectFirst(user, ipc, { queriesTab: true });
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
    expect(getWorkspaceTabs()).toHaveLength(2);
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
    expect(getWorkspaceTabs()).toHaveLength(2);
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
    await connectFirst(user, ipc, { queriesTab: true });
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
  it("collapse hides Connection and the sidebar panel; canvas stays visible", async () => {
    const ipc = createMockDragonIpc("happy");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    expect(screen.getByRole("region", { name: ConnectionCopy.panelTitle })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: ConnectionCopy.collapseConnection }));
    // The panel stays mounted so the column can animate closed; collapsed means
    // hidden from the accessibility tree, with the rail toggle in its place.
    expect(screen.queryByRole("region", { name: ConnectionCopy.panelTitle })).toBeNull();
    expect(screen.getByRole("button", { name: ConnectionCopy.showConnection })).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.initialAddBlock)).toBeInTheDocument();
  });

  it("window title follows the selected database", async () => {
    const ipc = createMockDragonIpc("happy");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.selectOptions(screen.getByTestId(ConnectionAccessibility.databasePicker), "app");
    await waitFor(() => expect(document.title).toBe("app"));
  });

  it("picker persists the active tab database without rewriting the profile", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.createDatabase("shop");
    const saveTabState = vi.spyOn(ipc, "saveTabState");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    const [profileBeforeSwitch] = await ipc.listProfiles();
    if (!profileBeforeSwitch) throw new Error("Expected the connected profile to exist");
    await user.selectOptions(screen.getByTestId(ConnectionAccessibility.databasePicker), "shop");

    await waitFor(() =>
      expect(saveTabState).toHaveBeenCalledWith(
        expect.objectContaining({ databaseName: "shop", isActive: true }),
        { includeCachedResults: false },
      ),
    );
    expect(await ipc.getProfile(profileBeforeSwitch.id)).toEqual(profileBeforeSwitch);
  });

  it("relaunch connects the persisted profile id instead of falling back to list[0]", async () => {
    const ipc = createMockDragonIpc("happy");
    const profileA = await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "A", host: "a.db" },
      secrets: { password: "pw" },
    });
    const profileB = await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "B", host: "b.db" },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "listTabStates").mockResolvedValue([
      {
        id: "tab-b",
        connectionId: profileB.id,
        databaseName: "app",
        queryText: "",
        savedQueryId: null,
        isActive: true,
        order: 0,
        createdAt: "1",
        lastAccessedAt: "1",
        selectedTableSchema: null,
        selectedTableName: null,
        selectedSchemaFilter: null,
        cachedResultsData: null,
        cachedColumnNames: null,
        visualDocumentJson: null,
      },
    ]);
    const connectProfile = vi.spyOn(ipc, "connectProfile");
    render(<App ipc={ipc} />);
    await waitFor(() => expect(connectProfile).toHaveBeenCalledWith(profileB.id));
    expect(connectProfile).not.toHaveBeenCalledWith(profileA.id);
  });

  it("deleting the selected database clears session, tab title, and table list", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.createDatabase("shop");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.selectOptions(screen.getByTestId(ConnectionAccessibility.databasePicker), "shop");
    await waitFor(() => expect(document.title).toBe("shop"));
    expect(screen.getByRole("button", { name: "users" })).toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: ConnectionCopy.deleteDatabase }));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.confirmDelete }));

    const combobox = screen.getByTestId(ConnectionAccessibility.databasePicker);
    await waitFor(() => expect(combobox).toHaveValue(""));
    expect(screen.getByText(ConnectionCopy.selectDbPulse)).toBeInTheDocument();
    expect(document.title).not.toBe("shop");
    expect(screen.queryByRole("button", { name: "users" })).toBeNull();
  });

  it("relaunch restores the database persisted by the picker", async () => {
    const ipc = createMockDragonIpc("happy");
    const profile = await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "listTabStates").mockResolvedValue([
      {
        id: "persisted-tab",
        connectionId: profile.id,
        databaseName: "shop",
        queryText: "",
        savedQueryId: null,
        isActive: true,
        order: 0,
        createdAt: "1",
        lastAccessedAt: "1",
        selectedTableSchema: null,
        selectedTableName: null,
        selectedSchemaFilter: null,
        cachedResultsData: null,
        cachedColumnNames: null,
        visualDocumentJson: null,
      },
    ]);
    vi.spyOn(ipc, "listDatabases").mockResolvedValue(["app", "shop"]);
    const switchDatabase = vi.spyOn(ipc, "switchDatabase");
    render(<App ipc={ipc} />);

    await waitFor(() => expect(switchDatabase).toHaveBeenCalledWith(expect.any(String), "shop"));
  });

  it("relaunch with a persisted database missing from the live list clears the selection", async () => {
    const ipc = createMockDragonIpc("happy");
    const profile = await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "listTabStates").mockResolvedValue([
      {
        id: "persisted-tab",
        connectionId: profile.id,
        databaseName: "shop",
        queryText: "",
        savedQueryId: null,
        isActive: true,
        order: 0,
        createdAt: "1",
        lastAccessedAt: "1",
        selectedTableSchema: null,
        selectedTableName: null,
        selectedSchemaFilter: null,
        cachedResultsData: null,
        cachedColumnNames: null,
        visualDocumentJson: null,
      },
    ]);
    // listDatabases only ever returns the connected login database ("app");
    // the persisted "shop" selection is missing from the live list.
    render(<App ipc={ipc} />);

    const combobox = await screen.findByTestId(ConnectionAccessibility.databasePicker);
    await waitFor(() => expect(combobox).toHaveValue(""));
    expect(screen.getByText(ConnectionCopy.selectDbPulse)).toBeInTheDocument();
    expect(document.title).not.toBe("shop");
    expect(document.title).not.toBe("app");
    await waitFor(() => expect(screen.queryByText("Loading databases…")).toBeNull());
    expect(screen.queryByText("Initializing…")).toBeNull();
    expect(screen.queryByText("Loading tables…")).toBeNull();
    const user = userEvent.setup();
    await user.selectOptions(combobox, "app");
    await waitFor(() => expect(combobox).toHaveValue("app"));
    expect(screen.queryByText(ConnectionCopy.selectDbPulse)).toBeNull();
  });

  it("keeps Loading tables visible until restore table loading completes", async () => {
    const ipc = createMockDragonIpc("happy");
    const profile = await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    vi.spyOn(ipc, "listTabStates").mockResolvedValue([
      {
        id: "restored-tab",
        connectionId: profile.id,
        databaseName: "app",
        queryText: "",
        savedQueryId: null,
        isActive: true,
        order: 0,
        createdAt: "1",
        lastAccessedAt: "1",
        selectedTableSchema: null,
        selectedTableName: null,
        selectedSchemaFilter: null,
        cachedResultsData: null,
        cachedColumnNames: null,
        visualDocumentJson: null,
      },
    ]);
    let releaseTables!: () => void;
    const tablesGate = new Promise<void>((resolve) => {
      releaseTables = resolve;
    });
    const listTables = vi.spyOn(ipc, "listTables").mockImplementation(async () => {
      await tablesGate;
      return [];
    });

    render(<App ipc={ipc} />);

    expect(await screen.findByText("Loading tables…")).toBeInTheDocument();
    expect(listTables).toHaveBeenCalled();
    expect(screen.getByText("Loading tables…")).toBeInTheDocument();
    releaseTables();
    await waitFor(() => expect(screen.queryByText("Loading tables…")).toBeNull());
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

describe("App tab remainder (SP-4b last slice T11)", () => {
  function persistedTab(overrides: Partial<TabStateDto>): TabStateDto {
    return {
      id: "tab-1",
      connectionId: null,
      databaseName: "app",
      queryText: "",
      savedQueryId: null,
      isActive: true,
      order: 0,
      createdAt: "1",
      lastAccessedAt: "1",
      selectedTableSchema: null,
      selectedTableName: null,
      selectedSchemaFilter: null,
      cachedResultsData: null,
      cachedColumnNames: null,
      visualDocumentJson: null,
      ...overrides,
    };
  }

  it("renders saved-query and connection/database titles from live app data", async () => {
    const ipc = createMockDragonIpc("happy");
    const profile = await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev", database: "shop" },
      secrets: { password: "pw" },
    });
    const daily: SavedQueryDto = {
      id: "daily",
      name: "Daily",
      queryText: "SELECT 1",
      connectionId: profile.id,
      databaseName: "shop",
      createdAt: "1",
      updatedAt: "1",
      folderId: null,
    };
    vi.spyOn(ipc, "listSavedQueries").mockResolvedValue([daily]);
    vi.spyOn(ipc, "listTabStates").mockResolvedValue([
      persistedTab({
        id: "saved",
        connectionId: profile.id,
        databaseName: "shop",
        savedQueryId: "daily",
        isActive: true,
      }),
      persistedTab({
        id: "plain",
        connectionId: profile.id,
        databaseName: "shop",
        isActive: false,
        order: 1,
      }),
    ]);

    render(<App ipc={ipc} />);

    expect(await screen.findByRole("tab", { name: "shop / Daily" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "dev / shop" })).toBeInTheDocument();
  });

  it("hydrates the active canvas from visualDocumentJson on launch", async () => {
    const ipc = createMockDragonIpc("happy");
    const profile = await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    const document = new QueryDocument();
    document.chooseStatement("select");
    document.addClause("from");
    document.selectFromTable("orders", "public");
    vi.spyOn(ipc, "listTabStates").mockResolvedValue([
      persistedTab({
        connectionId: profile.id,
        visualDocumentJson: serializeQueryDocument(document),
      }),
    ]);

    render(<App ipc={ipc} />);

    expect(
      await screen.findByTestId(VisualQueryAccessibility.clauseCard("from")),
    ).toBeInTheDocument();
  });

  it("shows Closing while deleteTabState is pending", async () => {
    let releaseDelete!: () => void;
    const deleteGate = new Promise<void>((resolve) => {
      releaseDelete = resolve;
    });
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "deleteTabState").mockImplementation(async () => deleteGate);
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByTestId(TabBarAccessibility.newTab));

    const [firstClose] = screen.getAllByRole("button", { name: /close tab/i });
    if (firstClose === undefined) throw new Error("Expected a close button");
    await user.click(firstClose);

    expect(screen.getByRole("tab", { name: "Closing..." })).toBeInTheDocument();
    releaseDelete();
    await waitFor(() => expect(screen.queryByText("Closing...")).toBeNull());
  });

  it("persists visual edits in visualDocumentJson without replacing queryText", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saveTabState = vi.spyOn(ipc, "saveTabState");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));

    await waitFor(() =>
      expect(saveTabState).toHaveBeenCalledWith(
        expect.objectContaining({
          queryText: "",
          visualDocumentJson: expect.stringContaining('"statementKind":"select"'),
        }),
        { includeCachedResults: false },
      ),
    );
  });

  it("persists and restores the SQL buffer when switching tabs", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const saveTabState = vi.spyOn(ipc, "saveTabState");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("radio", { name: /sql/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "SQL editor" }), {
      target: { value: "SELECT 42" },
    });

    await user.click(screen.getByTestId(TabBarAccessibility.newTab));

    await waitFor(() =>
      expect(saveTabState).toHaveBeenCalledWith(
        expect.objectContaining({ queryText: "SELECT 42", isActive: false }),
        { includeCachedResults: false },
      ),
    );
    const [firstTab] = getWorkspaceTabs();
    if (firstTab === undefined) throw new Error("Expected the first tab");
    await user.click(firstTab);
    await user.click(screen.getByRole("radio", { name: /sql/i }));
    expect(screen.getByRole("textbox", { name: "SQL editor" })).toHaveValue("SELECT 42");
  });
});

describe("App shell — mutation toast host, background persist, no-db alert (SP-4b last slice T12)", () => {
  it("App.tsx mounts useBackgroundPersist in the workspace tree", () => {
    const src = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    expect(src).toMatch(/useBackgroundPersist/);
  });

  it("disconnected Accel+Enter is a no-op without the no-database alert", async () => {
    const user = userEvent.setup();
    render(<App ipc={createMockDragonIpc("happy")} />);
    await user.keyboard("{Meta>}{Enter}{/Meta}");
    expect(
      screen.queryByText("Select a database from the sidebar before running queries."),
    ).toBeNull();
  });

  it("App workspace copy includes the Swift no-database Run alert (Visual + SQL; hatch behavior in T9)", () => {
    let src = readFileSync(join(process.cwd(), "src/App.tsx"), "utf8");
    try {
      src += readFileSync(join(process.cwd(), "src/ui/shell/app-workspace.tsx"), "utf8");
    } catch {
      /* extract happens in this task; App.tsx alone is enough until then */
    }
    expect(src).toMatch(/Select a database from the sidebar before running queries/);
  });

  it("0-row UPDATE via the SQL hatch shows the mutation toast; View Table browses the table", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("radio", { name: /sql/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "SQL editor" }), {
      target: { value: "UPDATE users SET name = 'Ada' WHERE false" },
    });
    await user.click(screen.getByRole("button", { name: "Run" }));
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));

    const viewTable = await screen.findByRole("button", { name: /view table/i });
    await user.click(viewTable);

    expect(screen.queryByRole("button", { name: /view table/i })).toBeNull();
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(2));
    expect(runQuery.mock.calls[1]?.[1]).toMatchObject({
      text: expect.stringMatching(/SELECT \* FROM "users"/i),
    });
  });

  it("connected no-db Accel+Enter shows the Swift alert on the Visual surface, not runQuery", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc, { selectDatabase: false });
    await addSelectFromUsers(user);
    expect(screen.getByTestId(VisualQueryAccessibility.runQuery)).not.toBeDisabled();

    window.dispatchEvent(
      new KeyboardEvent("keydown", { key: "Enter", ctrlKey: true, bubbles: true }),
    );
    expect(
      await screen.findByText("Select a database from the sidebar before running queries."),
    ).toBeInTheDocument();
    expect(runQuery).not.toHaveBeenCalled();
  });
});

describe("App table browser host wiring", () => {
  it("clicking a listed table name browses into the results grid; mere focus does not", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: [[1]],
      rowsAffected: null,
      durationMs: 4,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    const name = await screen.findByRole("button", { name: "users" });
    name.focus();
    expect(runQuery).not.toHaveBeenCalled();
    await user.click(name);
    await waitFor(() => expect(runQuery).toHaveBeenCalled());
    // Browse pages are ordered so LIMIT/OFFSET is deterministic: by primary key
    // when the catalog columns are loaded, by ctid on a heap table otherwise.
    // Columns are not fetched yet on this first click, so ctid is expected.
    expect(runQuery.mock.calls[0]?.[1]).toMatchObject({
      text: expect.stringMatching(
        /SELECT \* FROM "public"\."users" ORDER BY ctid LIMIT 101 OFFSET 0/i,
      ),
    });
    expect(await screen.findByTestId(ResultsAccessibility.grid)).toBeInTheDocument();
  });

  it("expanding the first table loads columns and shows the PK icon", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const listColumns = vi.spyOn(ipc, "listColumns");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByRole("button", { name: TablesCopy.expandColumns }));
    await waitFor(() => expect(listColumns).toHaveBeenCalled());
    expect(listColumns.mock.calls[0]?.[1]).toMatchObject({ schema: "public", name: "users" });
    expect(await screen.findByLabelText(TablesCopy.primaryKey)).toBeInTheDocument();
  });

  it("Drop confirm calls ipc.dropTable, not hatch runQuery", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const dropTable = vi.spyOn(ipc, "dropTable");
    const runQuery = vi.spyOn(ipc, "runQuery");
    const listTables = vi.spyOn(ipc, "listTables");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    const tablesAfterConnect = listTables.mock.calls.length;
    const tableMenus = await screen.findAllByRole("button", { name: TablesCopy.menu });
    const firstMenu = tableMenus[0];
    if (firstMenu === undefined) throw new Error("expected Table actions");
    await user.click(firstMenu);
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.drop }));
    await user.click(screen.getByRole("button", { name: TablesCopy.confirmDrop }));
    await waitFor(() => expect(dropTable).toHaveBeenCalled());
    expect(dropTable.mock.calls[0]?.[1]).toMatchObject({ schema: "public", name: "users" });
    expect(runQuery).not.toHaveBeenCalled();
    await waitFor(() => expect(listTables.mock.calls.length).toBeGreaterThan(tablesAfterConnect));
  });

  it("Drop IPC rejection shows an error and keeps the table listed", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "dropTable").mockRejectedValue({
      kind: "permission",
      message: "permission denied for table users",
    });
    const listTables = vi.spyOn(ipc, "listTables");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    const tablesAfterConnect = listTables.mock.calls.length;
    const tableMenus = await screen.findAllByRole("button", { name: TablesCopy.menu });
    const firstMenu = tableMenus[0];
    if (firstMenu === undefined) throw new Error("expected Table actions");
    await user.click(firstMenu);
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.drop }));
    await user.click(screen.getByRole("button", { name: TablesCopy.confirmDrop }));
    expect(await screen.findByText("permission denied for table users")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "users" })).toBeInTheDocument();
    expect(listTables.mock.calls.length).toBe(tablesAfterConnect);
  });

  it("Drop and Truncate menu items are disabled while a browse is in flight", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      await gate;
      return { columns: ["id"], rows: [[1]], rowsAffected: null, durationMs: 1 };
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(await screen.findByRole("button", { name: "users" }));
    const menuButtons = await screen.findAllByRole("button", { name: TablesCopy.menu });
    const firstMenu = menuButtons[0];
    if (firstMenu === undefined) throw new Error("expected Table actions");
    await user.click(firstMenu);
    await waitFor(() =>
      expect(screen.getByRole("menuitem", { name: TablesCopy.drop })).toBeDisabled(),
    );
    expect(screen.getByRole("menuitem", { name: TablesCopy.truncate })).toBeDisabled();
    release();
  });

  it("routes created database Connect through switchDatabase without raw SQL", async () => {
    const ipc = createMockDragonIpc("happy");
    const user = userEvent.setup();
    const createDatabase = vi.spyOn(ipc, "createDatabase");
    const switchDatabase = vi.spyOn(ipc, "switchDatabase");
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    fireEvent.change(screen.getByTestId(ConnectionAccessibility.createDatabaseName), {
      target: { value: "shop" },
    });
    await user.click(screen.getByRole("button", { name: ConnectionCopy.create }));
    await screen.findByText(ConnectionCopy.databaseCreated);
    expect(createDatabase).toHaveBeenCalledTimes(1);
    expect(switchDatabase).not.toHaveBeenCalledWith(expect.any(String), "shop");

    await user.click(screen.getByRole("button", { name: ConnectionCopy.connect }));
    await waitFor(() => expect(switchDatabase).toHaveBeenCalledWith(expect.any(String), "shop"));
    expect(createDatabase).toHaveBeenCalledTimes(1);
    expect(runQuery).not.toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ text: expect.stringMatching(/CREATE DATABASE/i) }),
    );
  });

  it("does not repeat a committed switch when its table reload fails", async () => {
    const ipc = createMockDragonIpc("happy");
    const listTables = vi.spyOn(ipc, "listTables");
    const switchDatabase = vi.spyOn(ipc, "switchDatabase");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    listTables.mockRejectedValueOnce(new Error("catalog offline"));

    await user.click(screen.getByRole("button", { name: ConnectionCopy.createDatabase }));
    fireEvent.change(screen.getByTestId(ConnectionAccessibility.createDatabaseName), {
      target: { value: "shop" },
    });
    await user.click(screen.getByRole("button", { name: ConnectionCopy.create }));
    await user.click(await screen.findByRole("button", { name: ConnectionCopy.connect }));
    const alert = await screen.findByRole("alert");
    expect(alert.tagName).toBe("P");
    expect(alert).toHaveTextContent(ConnectionCopy.tablesLoadError);
    expect(switchDatabase).toHaveBeenCalledTimes(1);
    expect(document.title).toBe("shop");
  });

  it("ignores a browse response released after the database context changes", async () => {
    let release!: (value: QueryResult) => void;
    const ipc = createMockDragonIpc("happy");
    await ipc.createDatabase("analytics");
    vi.spyOn(ipc, "runQuery").mockImplementationOnce(
      () =>
        new Promise<QueryResult>((resolve) => {
          release = resolve;
        }),
    );
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.selectOptions(
      screen.getByTestId(ConnectionAccessibility.databasePicker),
      "analytics",
    );
    release({ columns: ["id"], rows: [[99]], rowsAffected: null, durationMs: 1 });

    await waitFor(() => expect(document.title).toBe("analytics"));
    expect(screen.queryByText("99")).toBeNull();
  });

  it("clears browse results on disconnect and leaves them cleared after a failed reconnect", async () => {
    const ipc = createMockDragonIpc("happy");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("button", { name: "users" }));
    await screen.findByTestId(ResultsAccessibility.grid);
    await user.click(screen.getByRole("button", { name: /disconnect/i }));
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    vi.spyOn(ipc, "connectProfile").mockRejectedValueOnce(new Error("offline"));
    await user.click(screen.getByRole("button", { name: ConnectionCopy.connect }));
    await screen.findByText(/offline/i);
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
  });

  it("does not leak browse page onto the first tab after paging a second tab", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const pageRows = Array.from({ length: 101 }, (_, i) => [i]);
    const runQuery = vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: pageRows,
      rowsAffected: null,
      durationMs: 1,
    });
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    await user.click(await screen.findByRole("button", { name: "users" }));
    await screen.findByTestId(ResultsAccessibility.grid);

    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    await user.click(await screen.findByRole("button", { name: "analytics.events" }));
    await screen.findByTestId(ResultsAccessibility.grid);

    const nextPage = () => screen.getByRole("button", { name: ResultsCopy.nextPage });
    await user.click(nextPage());
    await waitFor(() =>
      expect(runQuery.mock.calls.some((call) => String(call[1]?.text).includes("OFFSET 100"))).toBe(
        true,
      ),
    );
    await user.click(nextPage());
    await waitFor(() =>
      expect(runQuery.mock.calls.some((call) => String(call[1]?.text).includes("OFFSET 200"))).toBe(
        true,
      ),
    );

    await clickWorkspaceTab(user, 0);
    await screen.findByTestId(ResultsAccessibility.grid);

    expect(screen.getByRole("button", { name: ResultsCopy.prevPage })).toBeDisabled();
    expect(
      runQuery.mock.calls.filter((call) =>
        /FROM "public"\."users"[\s\S]*OFFSET 100/.test(String(call[1]?.text)),
      ),
    ).toHaveLength(0);

    await user.click(nextPage());
    await waitFor(() =>
      expect(
        runQuery.mock.calls.filter((call) =>
          /FROM "public"\."users"[\s\S]*OFFSET 100/.test(String(call[1]?.text)),
        ),
      ).toHaveLength(1),
    );
    await waitFor(() =>
      expect(screen.getByRole("button", { name: ResultsCopy.prevPage })).toBeEnabled(),
    );

    await user.click(nextPage());
    await waitFor(() =>
      expect(
        runQuery.mock.calls.filter((call) =>
          /FROM "public"\."users"[\s\S]*OFFSET 200/.test(String(call[1]?.text)),
        ),
      ).toHaveLength(1),
    );
  });

  it("reuses Prev cache and Refresh invalidates before reloading", async () => {
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: Array.from({ length: 101 }, (_, index) => [index]),
      rowsAffected: null,
      durationMs: 1,
    });
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(await screen.findByRole("button", { name: ResultsCopy.nextPage }));
    await user.click(screen.getByRole("button", { name: ResultsCopy.prevPage }));
    expect(ipc.runQuery).toHaveBeenCalledTimes(2);

    await user.click(
      defined(screen.getAllByRole("button", { name: TablesCopy.menu })[0], "expected table menu"),
    );
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.refresh }));
    await waitFor(() => expect(ipc.runQuery).toHaveBeenCalledTimes(3));
  });

  // Row update/delete invalidation lives in Task 6 with its orchestrator, so
  // this task covers only the admin boundary it actually owns.
  it("invalidates all pages and reloads after a successful truncate", async () => {
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: Array.from({ length: 101 }, (_, index) => [index]),
      rowsAffected: null,
      durationMs: 1,
    });
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(await screen.findByRole("button", { name: ResultsCopy.nextPage }));
    await user.click(screen.getByRole("button", { name: ResultsCopy.prevPage }));
    expect(runQuery).toHaveBeenCalledTimes(2);

    await user.click(
      defined(screen.getAllByRole("button", { name: TablesCopy.menu })[0], "expected table menu"),
    );
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.truncate }));
    await user.click(screen.getByRole("button", { name: TablesCopy.confirmTruncate }));

    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(3));
    await user.click(screen.getByRole("button", { name: ResultsCopy.nextPage }));
    await user.click(screen.getByRole("button", { name: ResultsCopy.prevPage }));
    expect(runQuery.mock.calls.length).toBeGreaterThan(3);
  });

  it("clears identity instead of reloading a dropped table", async () => {
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id"],
      rows: Array.from({ length: 101 }, (_, index) => [index]),
      rowsAffected: null,
      durationMs: 1,
    });
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("button", { name: "users" }));
    await screen.findByTestId(ResultsAccessibility.grid);
    await user.click(
      defined(screen.getAllByRole("button", { name: TablesCopy.menu })[0], "expected table menu"),
    );
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.drop }));
    await user.click(screen.getByRole("button", { name: TablesCopy.confirmDrop }));
    await waitFor(() => expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull());
    expect(runQuery).toHaveBeenCalledTimes(1);
  });

  it("keeps Prev available when the current page reloads empty", async () => {
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    runQuery
      .mockResolvedValueOnce({
        columns: ["id"],
        rows: Array.from({ length: 101 }, (_, index) => [index]),
        rowsAffected: null,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        columns: ["id"],
        rows: Array.from({ length: 101 }, (_, index) => [index + 100]),
        rowsAffected: null,
        durationMs: 1,
      })
      .mockResolvedValueOnce({
        columns: ["id"],
        rows: [],
        rowsAffected: null,
        durationMs: 1,
      });
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(await screen.findByRole("button", { name: ResultsCopy.nextPage }));
    await user.click(
      defined(screen.getAllByRole("button", { name: TablesCopy.menu })[0], "expected table menu"),
    );
    await user.click(screen.getByRole("menuitem", { name: TablesCopy.refresh }));
    await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(3));
    expect(screen.getByRole("button", { name: ResultsCopy.prevPage })).toBeEnabled();
    expect(screen.getByText(ResultsCopy.noRowsFound)).toBeInTheDocument();
  });

  it("keeps listColumns metadata intact through App and QueryResultsPane", async () => {
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "runQuery").mockResolvedValue({
      columns: ["id", "occurred_on"],
      rows: [[42, "2026-08-18"]],
      rowsAffected: null,
      durationMs: 1,
    });
    vi.spyOn(ipc, "listColumns").mockResolvedValue([
      {
        name: "id",
        dataType: "bigint",
        isNullable: false,
        defaultValue: null,
        isPrimaryKey: true,
        isUnique: true,
        isForeignKey: false,
      },
      {
        name: "occurred_on",
        dataType: "date",
        isNullable: true,
        defaultValue: null,
        isPrimaryKey: false,
        isUnique: false,
        isForeignKey: false,
      },
    ]);
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(defined((await screen.findAllByRole("row"))[1], "expected first data row"));
    await user.click(screen.getByRole("button", { name: ResultsCopy.edit }));
    expect(screen.getByLabelText("id")).toBeDisabled();
    expect(screen.getByLabelText("occurred_on")).toHaveAttribute("type", "date");
  });

  it("retries only the row reload after a committed update", async () => {
    const ipc = createMockDragonIpc("happy");
    const updateRow = vi.spyOn(ipc, "updateRow").mockResolvedValue(undefined);
    const runQuery = vi.spyOn(ipc, "runQuery");
    runQuery
      .mockResolvedValueOnce({
        columns: ["id", "name"],
        rows: [[1, "before"]],
        rowsAffected: null,
        durationMs: 1,
      })
      .mockRejectedValueOnce(new Error("reload offline"))
      .mockResolvedValueOnce({
        columns: ["id", "name"],
        rows: [[1, "after"]],
        rowsAffected: null,
        durationMs: 1,
      });
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(defined((await screen.findAllByRole("row"))[1], "expected first data row"));
    await user.click(screen.getByRole("button", { name: ResultsCopy.edit }));
    await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
    expect(await screen.findByRole("alert")).toHaveTextContent("could not be reloaded");
    expect(updateRow).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: ResultsCopy.reloadRows }));
    await waitFor(() => expect(screen.getByText("after")).toBeInTheDocument());
    expect(updateRow).toHaveBeenCalledTimes(1);
    expect(runQuery).toHaveBeenCalledTimes(3);
  });

  const browsePage = (start: number) => ({
    columns: ["id"],
    rows: Array.from({ length: 101 }, (_, index) => [start + index]),
    rowsAffected: null,
    durationMs: 1,
  });

  it.each(["update", "delete"] as const)(
    "invalidates all pages and reloads after a successful %s",
    async (operation) => {
      const ipc = createMockDragonIpc("happy");
      vi.spyOn(ipc, "updateRow").mockResolvedValue(undefined);
      vi.spyOn(ipc, "deleteRows").mockResolvedValue(undefined);
      const runQuery = vi.spyOn(ipc, "runQuery").mockResolvedValue(browsePage(0));
      const user = userEvent.setup();
      render(<App ipc={ipc} />);
      await connectFirst(user, ipc);
      await user.click(screen.getByRole("button", { name: "users" }));
      await user.click(await screen.findByRole("button", { name: ResultsCopy.nextPage }));
      await user.click(screen.getByRole("button", { name: ResultsCopy.prevPage }));
      expect(runQuery).toHaveBeenCalledTimes(2);

      await user.click(defined((await screen.findAllByRole("row"))[1], "expected first data row"));
      await user.click(
        operation === "update"
          ? screen.getByRole("button", { name: ResultsCopy.edit })
          : within(screen.getByTestId(ResultsAccessibility.toolbar)).getByRole("button", {
              name: ResultsCopy.delete,
            }),
      );
      await user.click(
        operation === "update"
          ? screen.getByRole("button", { name: ResultsCopy.save })
          : defined(
              screen.getAllByRole("button", { name: ResultsCopy.delete }).slice(-1)[0],
              "expected delete confirm",
            ),
      );

      await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(3));
      await user.click(screen.getByRole("button", { name: ResultsCopy.nextPage }));
      await user.click(screen.getByRole("button", { name: ResultsCopy.prevPage }));
      expect(runQuery.mock.calls.length).toBeGreaterThan(3);
    },
  );

  it("keeps cached pages when an update fails", async () => {
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "updateRow").mockRejectedValue({ kind: "updateFailed", message: "denied" });
    const runQuery = vi.spyOn(ipc, "runQuery").mockResolvedValue(browsePage(0));
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.click(screen.getByRole("button", { name: "users" }));
    await user.click(await screen.findByRole("button", { name: ResultsCopy.nextPage }));
    await user.click(screen.getByRole("button", { name: ResultsCopy.prevPage }));
    expect(runQuery).toHaveBeenCalledTimes(2);

    await user.click(defined((await screen.findAllByRole("row"))[1], "expected first data row"));
    await user.click(screen.getByRole("button", { name: ResultsCopy.edit }));
    await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
    await screen.findByRole("alert");
    await user.click(screen.getByRole("button", { name: ResultsCopy.cancel }));
    await user.click(screen.getByRole("button", { name: ResultsCopy.nextPage }));
    await user.click(screen.getByRole("button", { name: ResultsCopy.prevPage }));
    expect(runQuery).toHaveBeenCalledTimes(2);
  });

  it("does not start a second browse until explicit reconnect completes", async () => {
    const ipc = createMockDragonIpc("happy");
    vi.spyOn(ipc, "runQuery").mockImplementation(() => new Promise(() => {}));
    vi.spyOn(ipc, "cancelQuery").mockImplementation(() => new Promise(() => {}));
    const reconnect = vi.spyOn(ipc, "connectProfile");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    vi.useFakeTimers();
    try {
      const timedUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      await timedUser.click(screen.getByRole("button", { name: "users" }));
      await vi.advanceTimersByTimeAsync(312_000);
      expect(screen.getByRole("button", { name: ResultsCopy.tryAgain })).toBeDisabled();
      await timedUser.click(screen.getByRole("button", { name: ResultsCopy.reconnect }));
      await waitFor(() => expect(reconnect).toHaveBeenCalledTimes(2));
      expect(ipc.runQuery).toHaveBeenCalledTimes(1);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe("App tab switch reconciles the live database", () => {
  // Per-tab databaseName is only a projection: SQL runs against whatever
  // database the Rust session last switched to. Switching tabs must therefore
  // push the target tab's database back onto the live connection, otherwise the
  // canvas shows tab 1's database while queries hit tab 2's.
  it("switching back to tab 1 switches the live database back to tab 1's database", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.createDatabase("shop");
    await ipc.createDatabase("warehouse");
    const switchDatabase = vi.spyOn(ipc, "switchDatabase");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    await user.selectOptions(screen.getByTestId(ConnectionAccessibility.databasePicker), "shop");
    await waitFor(() => expect(switchDatabase).toHaveBeenLastCalledWith(expect.anything(), "shop"));

    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    await user.selectOptions(
      screen.getByTestId(ConnectionAccessibility.databasePicker),
      "warehouse",
    );
    await waitFor(() =>
      expect(switchDatabase).toHaveBeenLastCalledWith(expect.anything(), "warehouse"),
    );

    switchDatabase.mockClear();
    await clickWorkspaceTab(user, 0);

    await waitFor(() => expect(switchDatabase).toHaveBeenCalledWith(expect.anything(), "shop"));
  });
});

describe("failed database switch on tab activation", () => {
  // handleSwitchTab activates the target tab, then fires switchDatabase and
  // swallows rejection. On failure the active tab claims database B while the
  // Rust session is still on database A, so later SQL runs on the wrong one.
  it("does not leave the active tab claiming a database the session never switched to", async () => {
    const ipc = createMockDragonIpc("happy");
    await ipc.createDatabase("shop");
    await ipc.createDatabase("warehouse");
    const saveTabState = vi.spyOn(ipc, "saveTabState");
    const switchDatabase = vi.spyOn(ipc, "switchDatabase");
    const user = userEvent.setup();
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);

    await user.selectOptions(screen.getByTestId(ConnectionAccessibility.databasePicker), "shop");
    await waitFor(() => expect(document.title).toBe("shop"));

    await user.click(screen.getByTestId(TabBarAccessibility.newTab));
    await user.selectOptions(
      screen.getByTestId(ConnectionAccessibility.databasePicker),
      "warehouse",
    );
    await waitFor(() => expect(document.title).toBe("warehouse"));

    // The backend refuses the switch back to tab 1's database.
    switchDatabase.mockRejectedValueOnce(new Error("switch failed"));
    await clickWorkspaceTab(user, 0);
    await waitFor(() => expect(switchDatabase).toHaveBeenLastCalledWith(expect.anything(), "shop"));

    // document.title follows the LIVE session database.
    const liveDatabase = document.title;
    const activeTabPersists = saveTabState.mock.calls
      .map(([dto]) => dto)
      .filter((dto) => dto.isActive);
    const activeTabDatabase = activeTabPersists[activeTabPersists.length - 1]?.databaseName;

    expect(activeTabDatabase).toBe(liveDatabase);
    // The rejection must be visible, not swallowed.
    expect(screen.getByText(ConnectionCopy.databaseSwitchError)).toBeInTheDocument();
  });
});

describe("SQL cancellation that the backend rejects", () => {
  // handleCancelSql marks the tab cancelled before cancelQuery resolves and
  // swallows its rejection, so a failed cancellation still reads as cancelled
  // while PostgreSQL keeps executing the statement.
  it("does not report the run as cancelled when cancelQuery fails", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runQuery = vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      await gate;
      return { columns: ["n"], rows: [[99]], rowsAffected: null, durationMs: 12 };
    });
    const cancelQuery = vi.spyOn(ipc, "cancelQuery").mockRejectedValue(new Error("cancel refused"));
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.selectOptions(screen.getByLabelText("Catalog"), "app");
    await waitFor(() => expect(document.title).toBe("app"));
    await user.click(screen.getByRole("radio", { name: /sql/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "SQL editor" }), {
      target: { value: "SELECT pg_sleep(10)" },
    });

    vi.useFakeTimers();
    try {
      const timerUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      fireEvent.click(screen.getByRole("button", { name: SqlHatchCopy.run }));
      await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(3001);
      await timerUser.keyboard("{Escape}");
    } finally {
      vi.useRealTimers();
    }

    await waitFor(() => expect(cancelQuery).toHaveBeenCalledTimes(1));
    // The statement was never cancelled — the UI must not claim it was.
    expect(screen.queryByText(SqlHatchCopy.queryCancelled)).toBeNull();

    release();
  });

  it("does not silently discard the result of a run whose cancellation failed", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const runQuery = vi.spyOn(ipc, "runQuery").mockImplementation(async () => {
      await gate;
      return { columns: ["n"], rows: [[99]], rowsAffected: null, durationMs: 12 };
    });
    const cancelQuery = vi.spyOn(ipc, "cancelQuery").mockRejectedValue(new Error("cancel refused"));
    render(<App ipc={ipc} />);
    await connectFirst(user, ipc);
    await user.selectOptions(screen.getByLabelText("Catalog"), "app");
    await waitFor(() => expect(document.title).toBe("app"));
    await user.click(screen.getByRole("radio", { name: /sql/i }));
    fireEvent.change(screen.getByRole("textbox", { name: "SQL editor" }), {
      target: { value: "SELECT pg_sleep(10)" },
    });

    vi.useFakeTimers();
    try {
      const timerUser = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
      fireEvent.click(screen.getByRole("button", { name: SqlHatchCopy.run }));
      await waitFor(() => expect(runQuery).toHaveBeenCalledTimes(1));
      await vi.advanceTimersByTimeAsync(3001);
      await timerUser.keyboard("{Escape}");
    } finally {
      vi.useRealTimers();
    }
    await waitFor(() => expect(cancelQuery).toHaveBeenCalledTimes(1));

    // PostgreSQL kept executing and the statement completed. Its rows must not
    // vanish: applyRunCancelled already bumped the generation, so the result is
    // dropped as stale even though the cancellation never happened.
    release();
    await waitFor(() => expect(screen.queryByTestId(ResultsAccessibility.grid)).not.toBeNull());
  });
});
