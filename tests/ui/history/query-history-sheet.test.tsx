/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { DragonIpc, HistoryDto } from "../../../src/ipc/contract";
import { createHistoryStore } from "../../../src/stores/history-store";
import { HistoryAccessibility } from "../../../src/ui/history/history-accessibility";
import { HistoryCopy } from "../../../src/ui/history/history-copy";
import { QueryHistorySheet } from "../../../src/ui/history/query-history-sheet";

afterEach(() => cleanup());

function historyRow(partial: Partial<HistoryDto> = {}): HistoryDto {
  return {
    id: "h1",
    profileId: "P",
    sql: "SELECT 1",
    success: true,
    errorMessage: null,
    durationMs: 12,
    rowCount: 1,
    createdAt: "2026-08-15T14:03:09.000Z",
    ...partial,
  };
}

describe("QueryHistorySheet", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    writeText.mockClear();
  });

  it("shows empty copy and disables Export when there are no rows", async () => {
    const listHistory = vi.fn(async () => []);
    const store = createHistoryStore({ listHistory } as unknown as DragonIpc);
    render(
      <QueryHistorySheet
        open={true}
        onOpenChange={vi.fn()}
        historyStore={store}
        saveTextFile={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByText(HistoryCopy.empty)).toHaveTextContent("No Query History"),
    );
    expect(screen.getByText(HistoryCopy.emptyHint)).toHaveTextContent(
      "Executed queries will appear here.",
    );
    expect(screen.getByTestId("history.exports")).toBeInTheDocument();
    expect(screen.getByTestId(HistoryAccessibility.exports)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: HistoryCopy.exportJson })).toBeDisabled();
    expect(screen.getByRole("button", { name: HistoryCopy.exportCsv })).toBeDisabled();
    expect(screen.getByRole("button", { name: HistoryCopy.exportSql })).toBeDisabled();
  });

  it("shows load error instead of empty copy when listHistory rejects", async () => {
    const listHistory = vi.fn(async () => {
      throw new Error("history boom");
    });
    const store = createHistoryStore({ listHistory } as unknown as DragonIpc);
    render(
      <QueryHistorySheet
        open={true}
        onOpenChange={vi.fn()}
        historyStore={store}
        saveTextFile={vi.fn()}
      />,
    );
    await waitFor(() =>
      expect(screen.getByTestId(HistoryAccessibility.loadError)).toBeInTheDocument(),
    );
    expect(screen.queryByText(HistoryCopy.empty)).toBeNull();
  });

  it("lists rows, Copy copies SQL, and row click is inert", async () => {
    const user = userEvent.setup();
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    const listHistory = vi.fn(async () => [
      historyRow({ id: "h2", sql: "SELECT 2", createdAt: "2" }),
      historyRow({ id: "h1", sql: "SELECT 1", createdAt: "1", success: false }),
    ]);
    const store = createHistoryStore({ listHistory } as unknown as DragonIpc);
    render(
      <QueryHistorySheet
        open={true}
        onOpenChange={vi.fn()}
        historyStore={store}
        saveTextFile={vi.fn()}
      />,
    );
    expect(await screen.findByText("SELECT 2")).toBeInTheDocument();
    expect(screen.getByText("SELECT 1")).toBeInTheDocument();
    await user.click(screen.getByTestId(HistoryAccessibility.copy("h2")));
    expect(writeText).toHaveBeenCalledWith("SELECT 2");
    await user.click(screen.getByTestId(HistoryAccessibility.row("h2")));
    expect(screen.getByTestId(HistoryAccessibility.row("h2"))).toBeInTheDocument();
  });

  it("export JSON/CSV/SQL calls saveTextFile with matching extensions; cancel writes once", async () => {
    const user = userEvent.setup();
    const listHistory = vi.fn(async () => [historyRow()]);
    const store = createHistoryStore({ listHistory } as unknown as DragonIpc);
    const saveTextFile = vi
      .fn()
      .mockResolvedValueOnce({ canceled: false, path: "/tmp/h.json" })
      .mockResolvedValueOnce({ canceled: true })
      .mockResolvedValueOnce({ canceled: false, path: "/tmp/h.csv" })
      .mockResolvedValueOnce({ canceled: false, path: "/tmp/h.sql" });
    render(
      <QueryHistorySheet
        open={true}
        onOpenChange={vi.fn()}
        historyStore={store}
        saveTextFile={saveTextFile}
      />,
    );
    await screen.findByText("SELECT 1");
    await user.click(screen.getByRole("button", { name: HistoryCopy.exportJson }));
    expect(saveTextFile).toHaveBeenCalledTimes(1);
    expect(saveTextFile.mock.calls[0]?.[2]?.extensions).toEqual(["json"]);
    await user.click(screen.getByRole("button", { name: HistoryCopy.exportJson }));
    expect(saveTextFile).toHaveBeenCalledTimes(2);
    await user.click(screen.getByRole("button", { name: HistoryCopy.exportCsv }));
    expect(saveTextFile.mock.calls[2]?.[2]?.extensions).toEqual(["csv"]);
    await user.click(screen.getByRole("button", { name: HistoryCopy.exportSql }));
    expect(saveTextFile.mock.calls[3]?.[2]?.extensions).toEqual(["sql"]);
    expect(saveTextFile).toHaveBeenCalledTimes(4);
  });

  it("shows an error when saveTextFile rejects and does not leak from the click handler", async () => {
    const user = userEvent.setup();
    const listHistory = vi.fn(async () => [historyRow()]);
    const store = createHistoryStore({ listHistory } as unknown as DragonIpc);
    const saveTextFile = vi.fn().mockRejectedValue(new Error("disk full"));
    render(
      <QueryHistorySheet
        open={true}
        onOpenChange={vi.fn()}
        historyStore={store}
        saveTextFile={saveTextFile}
      />,
    );
    await screen.findByText("SELECT 1");
    await expect(
      user.click(screen.getByRole("button", { name: HistoryCopy.exportJson })),
    ).resolves.toBeUndefined();
    expect(await screen.findByText("disk full")).toBeInTheDocument();
    expect(screen.queryByTestId(HistoryAccessibility.loadError)).toBeNull();
  });

  it("Done and Escape close the sheet", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const listHistory = vi.fn(async () => []);
    const store = createHistoryStore({ listHistory } as unknown as DragonIpc);
    render(
      <QueryHistorySheet
        open={true}
        onOpenChange={onOpenChange}
        historyStore={store}
        saveTextFile={vi.fn()}
      />,
    );
    await user.click(screen.getByTestId(HistoryAccessibility.done));
    expect(onOpenChange).toHaveBeenCalledWith(false);
    onOpenChange.mockClear();
    await user.keyboard("{Escape}");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it("keeps IPC newest-first DOM order and does not re-sort", async () => {
    const listHistory = vi.fn(async () => [
      historyRow({
        id: "newer",
        sql: "SELECT newer",
        createdAt: "2026-08-15T10:00:00.000Z",
      }),
      historyRow({
        id: "older",
        sql: "SELECT older",
        createdAt: "2026-08-01T10:00:00.000Z",
      }),
    ]);
    const store = createHistoryStore({ listHistory } as unknown as DragonIpc);
    render(
      <QueryHistorySheet
        open={true}
        onOpenChange={vi.fn()}
        historyStore={store}
        saveTextFile={vi.fn()}
      />,
    );
    expect(await screen.findByText("SELECT newer")).toBeInTheDocument();
    const newer = screen.getByTestId(HistoryAccessibility.row("newer"));
    const older = screen.getByTestId(HistoryAccessibility.row("older"));
    expect(newer.compareDocumentPosition(older) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("truncates SQL to five selectable lines and shows a relative date", async () => {
    const sixLine = "L1\nL2\nL3\nL4\nL5\nL6";
    const listHistory = vi.fn(async () => [
      historyRow({
        id: "six",
        sql: sixLine,
        createdAt: "2020-01-15T12:00:00.000Z",
      }),
    ]);
    const store = createHistoryStore({ listHistory } as unknown as DragonIpc);
    render(
      <QueryHistorySheet
        open={true}
        onOpenChange={vi.fn()}
        historyStore={store}
        saveTextFile={vi.fn()}
      />,
    );
    const sqlEl = await screen.findByTestId(HistoryAccessibility.sql("six"));
    expect(sqlEl).toHaveTextContent("L1");
    expect(sqlEl).toHaveTextContent("L5");
    expect(sqlEl.textContent).not.toContain("L6");
    expect(sqlEl).not.toBeDisabled();
    expect(sqlEl).not.toHaveAttribute("aria-hidden", "true");
    const row = screen.getByTestId(HistoryAccessibility.row("six"));
    expect(row.textContent).toMatch(/ago/i);
  });

  it("drops dead Export copy and CSS, and names the export group history.exports", () => {
    const copy = readFileSync(join(process.cwd(), "src/ui/history/history-copy.ts"), "utf8");
    const css = readFileSync(join(process.cwd(), "src/ui/history/history.css"), "utf8");
    const a11y = readFileSync(
      join(process.cwd(), "src/ui/history/history-accessibility.ts"),
      "utf8",
    );
    expect(copy).not.toMatch(/export:\s*"Export"/);
    expect(css).not.toMatch(/\.history-sheet__export,/);
    expect(a11y).toMatch(/exports:\s*"history\.exports"/);
  });
});
