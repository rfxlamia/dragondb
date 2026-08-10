/** @vitest-environment jsdom */
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockFactories = vi.hoisted(() => ({ createMockDragonIpc: vi.fn() }));

vi.mock("../../src/ipc/mock", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../src/ipc/mock")>();
  mockFactories.createMockDragonIpc.mockImplementation(actual.createMockDragonIpc);
  return { ...actual, createMockDragonIpc: mockFactories.createMockDragonIpc };
});

import App from "../../src/App";
import { createMockDragonIpc } from "../../src/ipc/mock";
import { VisualQueryAccessibility } from "../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../src/ui/visual-query/copy";

afterEach(() => {
  cleanup();
});

describe("App wiring", () => {
  beforeEach(() => {
    // The module-level default was created during import; calls after this point
    // would prove the factory leaked back into render.
    mockFactories.createMockDragonIpc.mockClear();
  });

  it("keeps the default IPC instance stable across rerenders", async () => {
    const { rerender } = render(<App />);
    await screen.findByTestId(VisualQueryAccessibility.initialAddBlock);
    rerender(<App />);
    expect(mockFactories.createMockDragonIpc).not.toHaveBeenCalled();
  });

  it("loads tables on mount into FROM picker", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    render(<App ipc={ipc} />);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    expect(await screen.findByRole("button", { name: "users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "analytics.events" })).toBeInTheDocument();
  });

  it("reloads columns after FROM commit and clears on start over", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const listColumns = vi.spyOn(ipc, "listColumns");
    render(<App ipc={ipc} />);
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
    // still need tables: override listTables from happy tables
    const happy = createMockDragonIpc("happy");
    ipc.listTables = happy.listTables.bind(happy);
    render(<App ipc={ipc} />);
    await user.click(await screen.findByTestId(VisualQueryAccessibility.initialAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.statementMenuItem("select")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.trailingAddBlock));
    await user.click(screen.getByTestId(VisualQueryAccessibility.clauseMenuItem("from")));
    await user.click(screen.getByTestId(VisualQueryAccessibility.fromTablePicker));
    await user.click(await screen.findByRole("button", { name: "users" }));
    expect(await screen.findByText(VisualQueryCopy.columnsLoadError)).toBeInTheDocument();
  });

  it("never calls runQuery during canvas editing", async () => {
    const user = userEvent.setup();
    const ipc = createMockDragonIpc("happy");
    const runQuery = vi.spyOn(ipc, "runQuery");
    render(<App ipc={ipc} />);
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
    const ipc = createMockDragonIpc("happy");
    const realColumns = ipc.listColumns.bind(ipc);
    let call = 0;
    ipc.listColumns = async (c, table) => {
      call += 1;
      if (call === 1) {
        await first;
        throw new Error("stale rejection");
      }
      return realColumns(c, table);
    };
    render(<App ipc={ipc} />);
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
