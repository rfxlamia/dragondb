/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { QueriesAccessibility } from "../../../src/ui/library/queries-accessibility";
import { QueriesColumn } from "../../../src/ui/library/queries-column";
import { QueriesCopy } from "../../../src/ui/library/queries-copy";

afterEach(() => {
  cleanup();
  // Safety net: a failing assertion inside a fake-timers test can skip its
  // own vi.useRealTimers() cleanup and hang every test after it.
  vi.useRealTimers();
});

const q1 = {
  id: "q1",
  name: "Q1",
  queryText: "SELECT 1",
  connectionId: null,
  databaseName: null,
  createdAt: "1",
  updatedAt: "1",
  folderId: null,
};
const folder = { id: "f1", name: "Folder", createdAt: "1", updatedAt: "1" };

describe("QueriesColumn", () => {
  it("shows No saved queries when the library is empty", () => {
    render(
      <QueriesColumn
        queries={[]}
        folders={[]}
        selectedQueryId={null}
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );
    expect(screen.getByTestId(QueriesAccessibility.column)).toHaveTextContent(QueriesCopy.empty);
    expect(QueriesCopy.empty).toBe("No saved queries");
  });

  it("shows folder headings when the query list is empty", () => {
    render(
      <QueriesColumn
        queries={[]}
        folders={[folder]}
        selectedQueryId={null}
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );
    expect(screen.getByText(QueriesCopy.empty)).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Folder" })).toBeInTheDocument();
  });

  it("disables rename Save when the name is blank", async () => {
    const user = userEvent.setup();
    render(
      <QueriesColumn
        queries={[q1]}
        folders={[]}
        selectedQueryId="q1"
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: QueriesCopy.rename }));
    await user.clear(screen.getByLabelText(QueriesCopy.name));
    expect(screen.getByRole("button", { name: QueriesCopy.save })).toBeDisabled();
  });

  it("runs a confirm step before deleteSavedQueries", async () => {
    const user = userEvent.setup();
    const onDeleteQuery = vi.fn();
    render(
      <QueriesColumn
        queries={[q1]}
        folders={[]}
        selectedQueryId="q1"
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={onDeleteQuery}
        onMoveQuery={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: QueriesCopy.delete }));
    expect(onDeleteQuery).not.toHaveBeenCalled();
    await user.click(screen.getByRole("button", { name: QueriesCopy.confirmDelete }));
    expect(onDeleteQuery).toHaveBeenCalledWith("q1");
  });

  it("move to folder calls onMoveQuery with the folder id", async () => {
    const user = userEvent.setup();
    const onMoveQuery = vi.fn();
    render(
      <QueriesColumn
        queries={[q1]}
        folders={[folder]}
        selectedQueryId="q1"
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={onMoveQuery}
        onDeleteFolder={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: QueriesCopy.move }));
    await user.click(screen.getByRole("button", { name: "Folder" }));
    expect(onMoveQuery).toHaveBeenCalledWith("q1", "f1");
  });

  it("delete folder offers Delete Folder Only and Delete Folder and Queries", async () => {
    const user = userEvent.setup();
    const onDeleteFolder = vi.fn();
    render(
      <QueriesColumn
        queries={[{ ...q1, folderId: "f1" }]}
        folders={[folder]}
        selectedQueryId="q1"
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={vi.fn()}
        onDeleteFolder={onDeleteFolder}
      />,
    );
    await user.click(screen.getByRole("button", { name: QueriesCopy.deleteFolder }));
    await user.click(screen.getByRole("button", { name: QueriesCopy.deleteFolderOnly }));
    expect(onDeleteFolder).toHaveBeenCalledWith("f1", false);
    await user.click(screen.getByRole("button", { name: QueriesCopy.deleteFolder }));
    await user.click(screen.getByRole("button", { name: QueriesCopy.deleteFolderAndQueries }));
    expect(onDeleteFolder).toHaveBeenCalledWith("f1", true);
  });

  it("filter zzz shows No matching queries", async () => {
    const user = userEvent.setup();
    render(
      <QueriesColumn
        queries={[
          { ...q1, name: "Alpha" },
          { ...q1, id: "q2", name: "Beta" },
        ]}
        folders={[]}
        selectedQueryId={null}
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );
    await user.type(screen.getByRole("searchbox"), "zzz");
    expect(screen.getByText(QueriesCopy.noMatchingQueries)).toBeInTheDocument();
  });

  it("deselect clears savedQueryId via onSelectQuery(null)", async () => {
    const user = userEvent.setup();
    const onSelectQuery = vi.fn();
    render(
      <QueriesColumn
        queries={[q1]}
        folders={[]}
        selectedQueryId="q1"
        onSelectQuery={onSelectQuery}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );
    await user.click(screen.getByRole("button", { name: QueriesCopy.deselect }));
    expect(onSelectQuery).toHaveBeenCalledWith(null);
  });

  it("deletes an empty folder from the folder row", async () => {
    const user = userEvent.setup();
    const onDeleteFolder = vi.fn();
    render(
      <QueriesColumn
        queries={[]}
        folders={[{ id: "f-empty", name: "Laporan", createdAt: "1", updatedAt: "1" }]}
        selectedQueryId={null}
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={vi.fn()}
        onDeleteFolder={onDeleteFolder}
      />,
    );
    await user.click(screen.getByRole("button", { name: QueriesCopy.deleteFolder }));
    await user.click(screen.getByRole("button", { name: QueriesCopy.confirmDelete }));
    expect(onDeleteFolder).toHaveBeenCalledWith("f-empty", false);
  });

  it("refresh overlay is visible for at least 0.45s and gone once it elapses", async () => {
    vi.useFakeTimers();
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    const onRefresh = vi.fn(async () => undefined);
    render(
      <QueriesColumn
        queries={[]}
        folders={[]}
        selectedQueryId={null}
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={vi.fn()}
        onMoveQuery={vi.fn()}
        onDeleteFolder={vi.fn()}
        onRefresh={onRefresh}
      />,
    );
    await user.click(screen.getByRole("button", { name: QueriesCopy.refresh }));
    expect(screen.getByText(QueriesCopy.refreshing)).toBeInTheDocument();
    await vi.advanceTimersByTimeAsync(449);
    expect(screen.getByText(QueriesCopy.refreshing)).toBeInTheDocument();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(2);
    });
    expect(screen.queryByText(QueriesCopy.refreshing)).toBeNull();
    expect(screen.queryByTestId(QueriesAccessibility.refreshOverlay)).toBeNull();
    vi.useRealTimers();
  });

  it("Delete key opens the delete-query sheet when the sidebar (not an editor) has focus", async () => {
    const user = userEvent.setup();
    const onDeleteQuery = vi.fn();
    render(
      <QueriesColumn
        queries={[q1]}
        folders={[]}
        selectedQueryId="q1"
        onSelectQuery={vi.fn()}
        onNewQuery={vi.fn()}
        onRenameQuery={vi.fn()}
        onDeleteQuery={onDeleteQuery}
        onMoveQuery={vi.fn()}
        onDeleteFolder={vi.fn()}
      />,
    );
    document.body.focus();
    await user.keyboard("{Delete}");
    expect(screen.getByRole("button", { name: QueriesCopy.confirmDelete })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: QueriesCopy.confirmDelete }));
    expect(onDeleteQuery).toHaveBeenCalledWith("q1");
  });

  it("Delete key while a contenteditable hatch editor is focused edits SQL instead of opening the delete sheet", async () => {
    const user = userEvent.setup();
    const onDeleteQuery = vi.fn();
    render(
      <>
        <div contentEditable data-testid="fake-hatch">
          text
        </div>
        <QueriesColumn
          queries={[q1]}
          folders={[]}
          selectedQueryId="q1"
          onSelectQuery={vi.fn()}
          onNewQuery={vi.fn()}
          onRenameQuery={vi.fn()}
          onDeleteQuery={onDeleteQuery}
          onMoveQuery={vi.fn()}
          onDeleteFolder={vi.fn()}
        />
      </>,
    );
    screen.getByTestId("fake-hatch").focus();
    await user.keyboard("{Delete}");
    expect(screen.queryByRole("button", { name: QueriesCopy.confirmDelete })).toBeNull();
    expect(onDeleteQuery).not.toHaveBeenCalled();
  });
});
