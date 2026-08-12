import { beforeEach, describe, expect, it, vi } from "vitest";
import type { DragonIpc, HistoryDto } from "../../src/ipc/contract";
import { createHistoryStore } from "../../src/stores/history-store";

function row(partial: Partial<HistoryDto> & Pick<HistoryDto, "id" | "profileId">): HistoryDto {
  return {
    sql: "SELECT 1",
    success: true,
    errorMessage: null,
    durationMs: 1,
    rowCount: 1,
    createdAt: "1",
    ...partial,
  };
}

describe("history-store", () => {
  let listHistory: ReturnType<typeof vi.fn>;
  let deleteHistory: ReturnType<typeof vi.fn>;
  let clearHistory: ReturnType<typeof vi.fn>;
  let ipc: DragonIpc;

  beforeEach(() => {
    listHistory = vi.fn();
    deleteHistory = vi.fn(async () => undefined);
    clearHistory = vi.fn(async () => undefined);
    ipc = { listHistory, deleteHistory, clearHistory } as unknown as DragonIpc;
  });

  it("listHistory filters by profileId and limit (newest-first from ipc)", async () => {
    listHistory.mockResolvedValueOnce([
      row({ id: "h2", profileId: "P", createdAt: "2" }),
      row({ id: "h1", profileId: "P", createdAt: "1" }),
    ]);
    const store = createHistoryStore(ipc);
    await store.getState().refresh({ profileId: "P", limit: 10 });
    expect(listHistory).toHaveBeenCalledWith({ profileId: "P", limit: 10 });
    expect(store.getState().entries.map((e) => e.id)).toEqual(["h2", "h1"]);
  });

  it("deleteHistory removes one id then refreshes", async () => {
    listHistory
      .mockResolvedValueOnce([row({ id: "h1", profileId: "P" }), row({ id: "h2", profileId: "P" })])
      .mockResolvedValueOnce([row({ id: "h2", profileId: "P" })]);
    const store = createHistoryStore(ipc);
    await store.getState().refresh({ limit: 10 });
    await store.getState().deleteHistory("h1");
    expect(deleteHistory).toHaveBeenCalledWith("h1");
    expect(store.getState().entries.map((e) => e.id)).toEqual(["h2"]);
  });

  it("clearHistory(P) keeps Q rows after refresh", async () => {
    listHistory
      .mockResolvedValueOnce([
        row({ id: "hp", profileId: "P" }),
        row({ id: "hq", profileId: "Q" }),
      ])
      .mockResolvedValueOnce([row({ id: "hq", profileId: "Q" })]);
    const store = createHistoryStore(ipc);
    await store.getState().refresh({ limit: 50 });
    await store.getState().clearHistory("P");
    expect(clearHistory).toHaveBeenCalledWith("P");
    expect(store.getState().entries).toEqual([expect.objectContaining({ id: "hq", profileId: "Q" })]);
  });
});
