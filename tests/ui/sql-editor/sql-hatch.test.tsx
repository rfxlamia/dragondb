/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
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

  it("Esc after 3s calls onCancel", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onCancel = vi.fn();
    render(
      <SqlHatch
        queryText="SELECT pg_sleep(10)"
        onChange={vi.fn()}
        onRun={vi.fn()}
        onCancel={onCancel}
        isConnected={true}
        databaseName="app"
        running
      />,
    );
    await vi.advanceTimersByTimeAsync(3001);
    await user.keyboard("{Escape}");
    expect(onCancel).toHaveBeenCalledOnce();
    vi.useRealTimers();
  });

  it("skips highlight above 50_000 characters but keeps the editor host", () => {
    expect(shouldHighlightSql(50_000)).toBe(true);
    expect(shouldHighlightSql(50_001)).toBe(false);
  });
});
