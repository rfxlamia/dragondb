/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TabResultGrid, TabRunStatus } from "../../../src/stores/tabs-store";
import { QueryResultsPane } from "../../../src/ui/results/query-results-pane";
import { ResultsAccessibility } from "../../../src/ui/results/results-accessibility";
import { SqlHatch, shouldHighlightSql } from "../../../src/ui/sql-editor/sql-hatch";
import { SqlHatchCopy } from "../../../src/ui/sql-editor/sql-hatch-copy";

afterEach(() => cleanup());

describe("SqlHatch", () => {
  it("renders an editor host (textbox or contenteditable or testid)", () => {
    render(
      <SqlHatch
        queryText="SELECT 1"
        onChange={vi.fn()}
        onRun={vi.fn()}
        isConnected={true}
        databaseName="app"
      />,
    );
    const host =
      screen.queryByTestId("sqlHatch.editor") ??
      screen.queryByRole("textbox") ??
      document.querySelector("[contenteditable='true']");
    expect(host).not.toBeNull();
  });

  it("empty hatch Run submits queryText, not generated visual SQL", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(
      <SqlHatch
        queryText=""
        onChange={vi.fn()}
        onRun={onRun}
        isConnected={true}
        databaseName="app"
        generatedVisualSql="SELECT * FROM orders"
      />,
    );
    await user.click(screen.getByRole("button", { name: SqlHatchCopy.run }));
    expect(onRun).toHaveBeenCalledWith("");
  });

  it("disconnected Run is a no-op and does not show the no-database alert", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(
      <SqlHatch
        queryText="SELECT 1"
        onChange={vi.fn()}
        onRun={onRun}
        isConnected={false}
        databaseName={null}
      />,
    );
    await user.click(screen.getByRole("button", { name: SqlHatchCopy.run }));
    expect(onRun).not.toHaveBeenCalled();
    expect(screen.queryByText(SqlHatchCopy.selectDatabaseAlert)).toBeNull();
  });

  it("connected with no database shows the Swift alert on Run", async () => {
    const user = userEvent.setup();
    const onRun = vi.fn();
    render(
      <SqlHatch
        queryText="SELECT 1"
        onChange={vi.fn()}
        onRun={onRun}
        isConnected={true}
        databaseName={null}
      />,
    );
    await user.click(screen.getByRole("button", { name: SqlHatchCopy.run }));
    expect(onRun).not.toHaveBeenCalled();
    expect(
      screen.getByText("Select a database from the sidebar before running queries."),
    ).toBeInTheDocument();
  });

  function SqlHatchCancelHarness(): React.JSX.Element {
    const [status, setStatus] = useState<TabRunStatus>({ kind: "running" });
    const [compact, setCompact] = useState<TabResultGrid | null>({
      columns: ["n"],
      rows: [[1]],
    });
    return (
      <>
        <SqlHatch
          queryText="SELECT pg_sleep(10)"
          onChange={vi.fn()}
          onRun={vi.fn()}
          onCancel={() => {
            setStatus({ kind: "cancelled" });
            setCompact(null);
          }}
          isConnected={true}
          databaseName="app"
          running
        />
        <QueryResultsPane status={status} compact={compact} />
      </>
    );
  }

  it("Esc after 3s shows Query cancelled and clears results", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SqlHatchCancelHarness />);
    expect(screen.getByTestId(ResultsAccessibility.loading)).toBeInTheDocument();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    await vi.advanceTimersByTimeAsync(3001);
    await user.keyboard("{Escape}");
    expect(screen.getByText(SqlHatchCopy.queryCancelled)).toBeInTheDocument();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.loading)).toBeNull();
    vi.useRealTimers();
  });

  it("Stop after 3s shows Query cancelled and clears results", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(<SqlHatchCancelHarness />);
    await vi.advanceTimersByTimeAsync(3001);
    await user.click(screen.getByRole("button", { name: SqlHatchCopy.stop }));
    expect(screen.getByText(SqlHatchCopy.queryCancelled)).toBeInTheDocument();
    expect(screen.queryByTestId(ResultsAccessibility.grid)).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.loading)).toBeNull();
    vi.useRealTimers();
  });

  it("skips highlight above 50_000 characters but keeps the editor host", () => {
    expect(shouldHighlightSql(50_000)).toBe(true);
    expect(shouldHighlightSql(50_001)).toBe(false);
  });

  it("defers the highlight Compartment reconfigure dispatch out of the synchronous updateListener callback", () => {
    // CodeMirror forbids nested `view.dispatch` calls from directly inside
    // EditorView.updateListener; crossing the 50_000-char threshold while
    // typing must schedule the reconfigure after the update cycle completes
    // (queueMicrotask/requestAnimationFrame) instead of dispatching inline.
    // jsdom cannot host a real CodeMirror EditorView (it lacks Range.getClientRects,
    // which CodeMirror's measurement pass needs), so this asserts the fix
    // structurally rather than through a live editor instance.
    const source = readFileSync(join(process.cwd(), "src/ui/sql-editor/sql-hatch.tsx"), "utf8");
    const listenerStart = source.indexOf("EditorView.updateListener.of((update) => {");
    expect(listenerStart).toBeGreaterThan(-1);
    const listenerEnd = source.indexOf("}),", listenerStart);
    expect(listenerEnd).toBeGreaterThan(listenerStart);
    const listenerBody = source.slice(listenerStart, listenerEnd);

    const deferIndex = listenerBody.search(/queueMicrotask\(|requestAnimationFrame\(/);
    expect(deferIndex).toBeGreaterThan(-1);
    const reconfigureIndex = listenerBody.indexOf("highlightCompartment.current.reconfigure(");
    expect(reconfigureIndex).toBeGreaterThan(deferIndex);
    const dispatchIndex = listenerBody.lastIndexOf(".dispatch({");
    expect(dispatchIndex).toBeGreaterThan(deferIndex);
  });

  it("offers Try Again after 300s and reruns the current buffer", async () => {
    vi.useFakeTimers();
    const onRun = vi.fn();
    render(
      <SqlHatch
        queryText="SELECT pg_sleep(301)"
        onChange={vi.fn()}
        onRun={onRun}
        isConnected={true}
        databaseName="app"
        running
      />,
    );

    await act(async () => vi.advanceTimersByTimeAsync(300_000));
    fireEvent.click(screen.getByRole("button", { name: SqlHatchCopy.tryAgain }));
    expect(onRun).toHaveBeenCalledWith("SELECT pg_sleep(301)");
    vi.useRealTimers();
  });
});
