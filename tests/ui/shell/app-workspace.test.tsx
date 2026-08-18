/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { TabState } from "../../../src/stores/tabs-store";
import { QueriesAccessibility } from "../../../src/ui/library/queries-accessibility";
import { ResultsAccessibility } from "../../../src/ui/results/results-accessibility";
import { AppWorkspace, type AppWorkspaceProps } from "../../../src/ui/shell/app-workspace";

afterEach(() => {
  cleanup();
});

const tab: TabState = {
  id: "tab-1",
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
  cachedResultsData: null,
  cachedColumnNames: null,
  visualDocumentJson: null,
};

function stubProps(overrides: Partial<AppWorkspaceProps> = {}): AppWorkspaceProps {
  const noop = vi.fn();
  return {
    workspaceReady: true,
    tabs: [tab],
    activeTabId: tab.id,
    pendingDeletedIds: new Set(),
    profiles: [],
    profileId: null,
    libraryQueries: [],
    libraryFolders: [],
    savedQueryId: null,
    executingQueryId: null,
    schemaNames: [],
    selectedSchema: null,
    schemaError: null,
    status: { kind: "idle" },
    compact: null,
    raw: null,
    dateFormat: "iso8601",
    query: "",
    columnMetadata: [],
    browse: false,
    hasNextPage: false,
    hasPrevPage: false,
    onNextPage: noop,
    onPrevPage: noop,
    onUpdateRow: noop,
    onDeleteRows: noop,
    onSaveCsv: noop,
    mutationToast: null,
    canvas: <div data-testid="canvas-slot" />,
    onNewTab: noop,
    onSwitchTab: noop,
    onCloseTab: noop,
    onSelectQuery: noop,
    onNewQuery: noop,
    onRenameQuery: noop,
    onDeleteQuery: noop,
    onMoveQuery: noop,
    onDeleteFolder: noop,
    onLibraryRefresh: noop,
    onDuplicateQuery: noop,
    onRenameFolder: noop,
    onCreateFolder: () => ({ id: "folder" }),
    hasCachedResult: () => false,
    onSelectSchema: noop,
    onDismissSchemaError: noop,
    onDismissMutationToast: noop,
    onViewMutationTable: noop,
    ...overrides,
  };
}

describe("AppWorkspace layout", () => {
  it("keeps Queries in the canvas row so results span to the connection sidebar", () => {
    const { container } = render(<AppWorkspace {...stubProps()} />);
    const canvasPanel = container.querySelector("[data-min-canvas='250']");
    const resultsPanel = container.querySelector("[data-min-results='300']");
    const queries = screen.getByTestId(QueriesAccessibility.column);
    const results = screen.getByTestId(ResultsAccessibility.pane);

    expect(canvasPanel).not.toBeNull();
    expect(resultsPanel).not.toBeNull();
    expect(canvasPanel).toContainElement(queries);
    expect(resultsPanel).toContainElement(results);
    expect(resultsPanel).not.toContainElement(queries);
    expect(screen.getByTestId("canvas-slot")).toBeInTheDocument();
  });

  it("still shows Queries and omits the results split when the workspace is not ready", () => {
    const { container } = render(<AppWorkspace {...stubProps({ workspaceReady: false })} />);

    expect(screen.getByTestId(QueriesAccessibility.column)).toBeInTheDocument();
    expect(container.querySelector("[data-min-results='300']")).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.splitSeparator)).toBeNull();
    expect(screen.queryByTestId(ResultsAccessibility.pane)).toBeNull();
  });

  it("App.css lets the nested queries split fill the canvas panel without stealing results overflow", () => {
    const css = readFileSync(join(process.cwd(), "src/App.css"), "utf8");
    expect(css).toMatch(/\.workspace-split__canvas\s*\{[^}]*overflow:\s*hidden/);
    expect(css).toMatch(/\.workspace-split__results\s*\{[^}]*overflow:\s*auto/);
  });
});
