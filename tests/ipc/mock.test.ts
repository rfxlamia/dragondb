import { describe, expect, it } from "vitest";
import {
  createMockDragonIpc,
  FIXTURE_CONNECTION_ID,
  fixtureProfileFields,
} from "../../src/ipc/mock";
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
    const cols = await ipc.listColumns(FIXTURE_CONNECTION_ID, {
      name: "users",
      schema: "public",
      tableType: "regular",
    });
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
    expect(
      await ipc.listColumns(FIXTURE_CONNECTION_ID, { name: "users", tableType: "regular" }),
    ).toEqual([]);
  });

  it("columnsError rejects", async () => {
    const ipc = createMockDragonIpc("columnsError");
    await expect(
      ipc.listColumns(FIXTURE_CONNECTION_ID, { name: "users", tableType: "regular" }),
    ).rejects.toBeTruthy();
  });

  it("runQuery is present but unused by UI — returns empty result", async () => {
    const ipc = createMockDragonIpc("happy");
    const result = await ipc.runQuery(FIXTURE_CONNECTION_ID, { text: "SELECT 1", params: [] });
    expect(result.columns).toEqual([]);
    expect(result.rows).toEqual([]);
  });

  it("happy mock exposes last-slice methods and tableType / visualDocumentJson", async () => {
    const ipc = createMockDragonIpc("happy");
    expect(typeof ipc.testConnection).toBe("function");
    expect(typeof ipc.cancelQuery).toBe("function");
    expect(typeof ipc.switchDatabase).toBe("function");
    expect(typeof ipc.createDatabase).toBe("function");
    expect(typeof ipc.deleteDatabase).toBe("function");
    expect(typeof ipc.truncateTable).toBe("function");
    expect(typeof ipc.dropTable).toBe("function");
    expect(typeof ipc.generateTableDdl).toBe("function");
    expect(typeof ipc.setSearchPath).toBe("function");
    expect(typeof ipc.clearAllHistory).toBe("function");
    expect(await ipc.listDatabases(FIXTURE_CONNECTION_ID)).toEqual([]);
    const tables = await ipc.listTables(FIXTURE_CONNECTION_ID);
    expect(tables.length).toBeGreaterThan(0);
    expect(tables.every((t) => t.tableType === "regular" || t.tableType === "foreign")).toBe(true);
  });
});

describe("table ref helpers", () => {
  it("maps optional schema to TableReference", () => {
    expect(tableRefToCore({ name: "users", tableType: "regular" })).toEqual({
      schema: null,
      name: "users",
    });
    expect(tableRefToCore({ schema: "analytics", name: "events", tableType: "regular" })).toEqual({
      schema: "analytics",
      name: "events",
    });
  });

  it("round-trips TableReference to TableRef", () => {
    expect(coreToTableRef({ schema: null, name: "users" })).toEqual({
      name: "users",
      tableType: "regular",
    });
    expect(coreToTableRef({ schema: "analytics", name: "events" })).toEqual({
      schema: "analytics",
      name: "events",
      tableType: "regular",
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

describe("mock DragonIpc profile + connect surface", () => {
  it("listProfiles / getProfile / saveProfile / deleteProfile round-trip", async () => {
    const ipc = createMockDragonIpc("happy");
    expect(await ipc.listProfiles()).toEqual([]);

    const saved = await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: "dev" },
      secrets: { password: "pw" },
    });
    expect(saved.id).toBeTruthy();
    expect(saved).not.toHaveProperty("password");
    expect(await ipc.listProfiles()).toHaveLength(1);
    expect(await ipc.getProfile(saved.id)).toEqual(saved);

    const updated = await ipc.saveProfile({
      id: saved.id,
      profile: { ...fixtureProfileFields(), name: "dev", host: "db.internal" },
      secrets: { password: "pw" },
    });
    expect(updated.id).toBe(saved.id);
    expect(updated.host).toBe("db.internal");

    await ipc.deleteProfile(saved.id);
    expect(await ipc.getProfile(saved.id)).toBeNull();
    expect(await ipc.listProfiles()).toEqual([]);
  });

  it("connectProfile returns opaque connectionId distinct from profileId", async () => {
    const ipc = createMockDragonIpc("happy");
    const saved = await ipc.saveProfile({
      profile: { ...fixtureProfileFields(), name: null, sslMode: "disable" },
      secrets: { password: "pw" },
    });
    const result = await ipc.connectProfile(saved.id);
    expect(result.profileId).toBe(saved.id);
    expect(result.connectionId).toBeTruthy();
    expect(result.connectionId).not.toBe(result.profileId);
    await ipc.disconnect();
  });

  it("exports FIXTURE_CONNECTION_ID for tests only (still present)", () => {
    expect(FIXTURE_CONNECTION_ID).toBe("fixture");
  });
});
