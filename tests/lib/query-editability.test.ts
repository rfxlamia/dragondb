import { describe, expect, it } from "vitest";
import { determineEditability } from "../../src/lib/query-editability";

describe("determineEditability", () => {
  it("sourceTable short-circuit yields editable", () => {
    const result = determineEditability("SELECT * FROM anything", {
      sourceTable: { schema: "public", name: "users" },
    });
    expect(result.isEditable).toBe(true);
    expect(result.tableName).toBe("users");
    expect(result.schema).toBe("public");
  });

  it("simple single-table SELECT extracts table and is editable", () => {
    const result = determineEditability("SELECT id, name FROM public.orders", {});
    expect(result.isEditable).toBe(true);
    expect(result.tableName).toBe("orders");
    expect(result.schema).toBe("public");
  });

  it("unparseable / non-single-table yields Can't Edit Query Results", () => {
    const result = determineEditability("NOT SQL AT ALL ???", {});
    expect(result.isEditable).toBe(false);
    expect(result.reason?.title).toBe("Can't Edit Query Results");
  });

  it.each([
    ["CTE", "WITH c AS (SELECT 1) SELECT * FROM c", "Can't Edit CTE Results"],
    ["UNION", "SELECT 1 UNION SELECT 2", "Can't Edit Combined Results"],
    ["INTERSECT", "SELECT 1 INTERSECT SELECT 1", "Can't Edit Combined Results"],
    ["EXCEPT", "SELECT 1 EXCEPT SELECT 2", "Can't Edit Combined Results"],
    ["GROUP BY", "SELECT a, count(*) FROM t GROUP BY a", "Can't Edit Grouped Data"],
    ["DISTINCT", "SELECT DISTINCT a FROM t", "Can't Edit Distinct Results"],
    [
      "window",
      "SELECT a, row_number() OVER (ORDER BY a) FROM t",
      "Can't Edit Window Function Results",
    ],
    ["aggregate", "SELECT count(*) FROM t", "Can't Edit Aggregated Data"],
    ["multi-FROM", "SELECT * FROM a, b", "Can't Edit Multi-Table Results"],
    ["JOIN", "SELECT * FROM a JOIN b ON a.id = b.id", "Can't Edit Joined Results"],
  ] as const)("%s is not editable with Swift title", (_label, sql, title) => {
    const result = determineEditability(sql, {});
    expect(result.isEditable).toBe(false);
    expect(result.reason?.title).toBe(title);
  });
});
