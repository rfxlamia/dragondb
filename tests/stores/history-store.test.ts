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
      .mockResolvedValueOnce([row({ id: "hp", profileId: "P" }), row({ id: "hq", profileId: "Q" })])
      .mockResolvedValueOnce([row({ id: "hq", profileId: "Q" })]);
    const store = createHistoryStore(ipc);
    await store.getState().refresh({ limit: 50 });
    await store.getState().clearHistory("P");
    expect(clearHistory).toHaveBeenCalledWith("P");
    expect(store.getState().entries).toEqual([
      expect.objectContaining({ id: "hq", profileId: "Q" }),
    ]);
  });

  it("overlapping refresh applies only the latest response", async () => {
    let resolveOlder!: (rows: HistoryDto[]) => void;
    listHistory
      .mockImplementationOnce(
        () =>
          new Promise<HistoryDto[]>((resolve) => {
            resolveOlder = resolve;
          }),
      )
      .mockResolvedValueOnce([row({ id: "new", profileId: "P" })]);
    const store = createHistoryStore(ipc);
    const older = store.getState().refresh({ limit: 10 });
    await store.getState().refresh({ limit: 5 });
    resolveOlder([row({ id: "old", profileId: "P" })]);
    await older;
    expect(store.getState().entries.map((e) => e.id)).toEqual(["new"]);
  });

  it("refresh() with no args calls listHistory({ limit: 50 }) without profileId", async () => {
    listHistory.mockResolvedValueOnce([]);
    const store = createHistoryStore(ipc);
    await store.getState().refresh();
    expect(listHistory).toHaveBeenCalledWith({ limit: 50 });
    expect(listHistory.mock.calls[0]?.[0]).not.toHaveProperty("profileId");
  });

  it("listHistory reject sets loadError and does not look like empty success", async () => {
    listHistory.mockRejectedValueOnce(new Error("history boom"));
    const store = createHistoryStore(ipc);
    await store.getState().refresh();
    expect(store.getState().loadError).toEqual(expect.any(String));
    expect(store.getState().loadError?.length).toBeGreaterThan(0);
    expect(store.getState().entries).toEqual([]);
  });
});
