import { describe, expect, it } from "vitest";
import {
  detectQueryType,
  extractTableName,
  isMutation,
  type SqlQueryType,
} from "../../src/lib/query-type-detector";

describe("detectQueryType / extractTableName / isMutation", () => {
  it("classifies with Swift QueryType union (NOT core StatementKind-only)", () => {
    const expected: Record<string, SqlQueryType> = {
      "SELECT 1": "select",
      "INSERT INTO t VALUES (1)": "insert",
      "UPDATE t SET a=1": "update",
      "DELETE FROM t": "delete",
      "CREATE TABLE t (id int)": "createTable",
      "DROP TABLE t": "dropTable",
      "ALTER TABLE t ADD COLUMN x int": "alterTable",
      "EXPLAIN SELECT 1": "other",
      "WITH c AS (SELECT 1) SELECT * FROM c": "select",
    };
    for (const [sql, kind] of Object.entries(expected)) {
      expect(detectQueryType(sql)).toBe(kind);
    }
  });

  it("extractTableName finds simple FROM target", () => {
    expect(extractTableName("SELECT * FROM public.users")).toEqual({
      schema: "public",
      name: "users",
    });
    expect(extractTableName("SELECT * FROM users")).toEqual({
      schema: undefined,
      name: "users",
    });
  });

  it("extractTableName prefers INSERT/UPDATE target over subquery FROM", () => {
    expect(extractTableName("INSERT INTO t (a) SELECT a FROM s")).toEqual({
      schema: undefined,
      name: "t",
    });
    expect(extractTableName("UPDATE t SET a = (SELECT b FROM other)")).toEqual({
      schema: undefined,
      name: "t",
    });
  });

  it("extractTableName parses quoted schema and table segments", () => {
    expect(extractTableName('SELECT * FROM public."Order"')).toEqual({
      schema: "public",
      name: "Order",
    });
    expect(extractTableName('SELECT * FROM "audit"."Order"')).toEqual({
      schema: "audit",
      name: "Order",
    });
    expect(extractTableName('UPDATE "Order" SET a = 1')).toEqual({
      schema: undefined,
      name: "Order",
    });
  });

  it("isMutation matches Swift (DDL create/drop/alter are mutations; select/other are not)", () => {
    expect(isMutation("INSERT INTO t VALUES (1)")).toBe(true);
    expect(isMutation("UPDATE t SET a=1")).toBe(true);
    expect(isMutation("DELETE FROM t")).toBe(true);
    expect(isMutation("CREATE TABLE t (id int)")).toBe(true);
    expect(isMutation("DROP TABLE t")).toBe(true);
    expect(isMutation("ALTER TABLE t ADD COLUMN x int")).toBe(true);
    expect(isMutation("SELECT 1")).toBe(false);
    expect(isMutation("EXPLAIN SELECT 1")).toBe(false);
  });
});
