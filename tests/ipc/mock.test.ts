import { describe, expect, it } from "vitest";
import { createMockDragonIpc, FIXTURE_CONNECTION_ID } from "../../src/ipc/mock";
import { coreToTableRef, formatTableDisplayName, tableRefToCore } from "../../src/ipc/table-ref";

describe("mock DragonIpc", () => {
  it("happy path lists public + non-public schema tables", async () => {
    const ipc = createMockDragonIpc("happy");
    const tables = await ipc.listTables(FIXTURE_CONNECTION_ID);
    expect(
      tables.some((t) => t.name === "users" && (t.schema === undefined || t.schema === "public")),
    ).toBe(true);
    expect(tables.some((t) => t.schema === "analytics" && t.name === "events")).toBe(true);
  });

  it("happy path returns columns for users", async () => {
    const ipc = createMockDragonIpc("happy");
    const cols = await ipc.listColumns(FIXTURE_CONNECTION_ID, { name: "users", schema: "public" });
    expect(cols.map((c) => c.name)).toEqual(
      expect.arrayContaining(["id", "name", "email", "created_at"]),
    );
  });

  it("emptyTables returns []", async () => {
    const ipc = createMockDragonIpc("emptyTables");
    expect(await ipc.listTables(FIXTURE_CONNECTION_ID)).toEqual([]);
  });

  it("emptyColumns returns []", async () => {
    const ipc = createMockDragonIpc("emptyColumns");
    expect(await ipc.listColumns(FIXTURE_CONNECTION_ID, { name: "users" })).toEqual([]);
  });

  it("columnsError rejects", async () => {
    const ipc = createMockDragonIpc("columnsError");
    await expect(ipc.listColumns(FIXTURE_CONNECTION_ID, { name: "users" })).rejects.toBeTruthy();
  });

  it("runQuery is present but unused by UI — returns empty result", async () => {
    const ipc = createMockDragonIpc("happy");
    const result = await ipc.runQuery(FIXTURE_CONNECTION_ID, { text: "SELECT 1", params: [] });
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
  });
});

describe("table ref helpers", () => {
  it("maps optional schema to TableReference", () => {
    expect(tableRefToCore({ name: "users" })).toEqual({ schema: null, name: "users" });
    expect(tableRefToCore({ schema: "analytics", name: "events" })).toEqual({
      schema: "analytics",
      name: "events",
    });
  });

  it("round-trips TableReference to TableRef", () => {
    expect(coreToTableRef({ schema: null, name: "users" })).toEqual({ name: "users" });
    expect(coreToTableRef({ schema: "analytics", name: "events" })).toEqual({
      schema: "analytics",
      name: "events",
    });
  });

  it("formats display names like Swift", () => {
    expect(formatTableDisplayName({ schema: null, name: "users" })).toBe("users");
    expect(formatTableDisplayName({ schema: "public", name: "users" })).toBe("users");
    expect(formatTableDisplayName({ schema: "analytics", name: "events" })).toBe(
      "analytics.events",
    );
  });
});
