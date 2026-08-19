/**
 * Browse pages with LIMIT/OFFSET and no ORDER BY. PostgreSQL gives no stable
 * row order without one, so a plan change or a concurrent insert/delete can
 * make the same row appear on two pages or vanish between them.
 */
import { describe, expect, it } from "vitest";
import { browsePageSql } from "../../src/stores/browse-page-sql";

describe("browsePageSql", () => {
  it("orders by the primary key when the table has one", () => {
    const sql = browsePageSql({
      table: { schema: "public", name: "users", tableType: "regular" },
      page: 2,
      pageSize: 50,
      primaryKeyColumns: ["id"],
    });
    expect(sql).toContain('ORDER BY "id"');
    expect(sql.indexOf("ORDER BY")).toBeLessThan(sql.indexOf("LIMIT"));
    expect(sql).toContain("LIMIT 51");
    expect(sql).toContain("OFFSET 100");
  });

  it("orders by every primary-key column of a composite key, in order", () => {
    const sql = browsePageSql({
      table: { schema: "public", name: "memberships", tableType: "regular" },
      page: 0,
      pageSize: 50,
      primaryKeyColumns: ["org_id", "user_id"],
    });
    expect(sql).toContain('ORDER BY "org_id", "user_id"');
  });

  it("quotes primary-key columns that need it", () => {
    const sql = browsePageSql({
      table: { schema: "public", name: "t", tableType: "regular" },
      page: 0,
      pageSize: 50,
      primaryKeyColumns: ['weird"col'],
    });
    expect(sql).toContain('ORDER BY "weird""col"');
  });

  it("falls back to ctid for a regular table with no primary key", () => {
    const sql = browsePageSql({
      table: { schema: "public", name: "logs", tableType: "regular" },
      page: 1,
      pageSize: 50,
      primaryKeyColumns: [],
    });
    expect(sql).toContain("ORDER BY ctid");
  });

  it("omits ORDER BY for a foreign table with no primary key", () => {
    // Foreign tables have no ctid; ordering by it would make browse fail
    // outright, which is worse than an unstable order.
    const sql = browsePageSql({
      table: { schema: "public", name: "remote_orders", tableType: "foreign" },
      page: 0,
      pageSize: 50,
      primaryKeyColumns: [],
    });
    expect(sql).not.toContain("ORDER BY");
    expect(sql).toContain("LIMIT 51");
  });

  it("still orders a foreign table by its primary key when one is known", () => {
    const sql = browsePageSql({
      table: { schema: "public", name: "remote_orders", tableType: "foreign" },
      page: 0,
      pageSize: 50,
      primaryKeyColumns: ["id"],
    });
    expect(sql).toContain('ORDER BY "id"');
  });

  it("quotes the schema and table the same way the browse path always has", () => {
    const sql = browsePageSql({
      table: { schema: "public", name: "users", tableType: "regular" },
      page: 0,
      pageSize: 50,
      primaryKeyColumns: ["id"],
    });
    expect(sql).toContain('SELECT * FROM "public"."users"');
  });
});
