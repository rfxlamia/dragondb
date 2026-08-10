import { describe, expect, it } from "vitest";
import { QueryDocument } from "../../src/core/query-document";
import { escapeLikePattern, generateSQL, quoteIdentifier } from "../../src/core/sql-generator";

function selectFrom(table: string): QueryDocument {
  const doc = new QueryDocument();
  doc.chooseStatement("select");
  doc.addClause("from");
  doc.setFromTableText(table);
  return doc;
}

function displayOf(doc: QueryDocument): string {
  const sql = generateSQL(doc);
  expect(sql).not.toBeNull();
  if (sql === null) throw new Error("expected SQL");
  return sql.display;
}

describe("generateSQL — display", () => {
  it("generates SELECT * and invents no other clause", () => {
    const display = displayOf(selectFrom("orders"));
    expect(display.startsWith("SELECT *")).toBe(true);
    expect(display).toContain('FROM "orders"');
    expect(display.toUpperCase()).not.toContain("WHERE");
    expect(display.toUpperCase()).not.toContain("ORDER BY");
    expect(display.toUpperCase()).not.toContain("LIMIT");
  });

  it("escapes LIKE metacharacters and quotes for contains", () => {
    const doc = selectFrom("orders");
    doc.addClause("where");
    doc.setWhereCondition("name", "contains", "O'Brien%");
    const display = displayOf(doc);
    expect(display).toContain('"name"');
    expect(display).toContain("LIKE");
    expect(display).toContain("O''Brien");
    expect(display).toContain("\\%");
  });

  it("escapes percent, underscore, backslash, and apostrophe", () => {
    const doc = selectFrom("orders");
    doc.addClause("where");
    doc.setWhereCondition("name", "contains", "O'Brien%_\\");
    const display = displayOf(doc);
    expect(display).toContain("O''Brien");
    expect(display).toContain("\\%");
    expect(display).toContain("\\_");
    expect(display).toContain("ESCAPE");
  });

  it("generates IS NULL for isEmpty, never an equality against empty string", () => {
    const doc = selectFrom("orders");
    doc.addClause("where");
    doc.setWhereCondition("email", "isEmpty", null);
    const display = displayOf(doc);
    expect(display).toContain('"email" IS NULL');
    expect(display).not.toContain("= ''");
  });

  it("maps CREATE TABLE column types", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    doc.setCreateTableName("notes");
    doc.setCreateColumns([
      { name: "body", type: "text" },
      { name: "amount", type: "number" },
      { name: "created_at", type: "date" },
      { name: "active", type: "boolean" },
    ]);
    const display = displayOf(doc);
    expect(display).toContain('CREATE TABLE "notes"');
    expect(display).toContain('"body" TEXT');
    expect(display).toContain('"amount" NUMERIC');
    expect(display).toContain('"created_at" DATE');
    expect(display).toContain('"active" BOOLEAN');
  });

  it("returns null for UPDATE and DELETE", () => {
    for (const kind of ["update", "delete"] as const) {
      const doc = new QueryDocument();
      doc.chooseStatement(kind);
      expect(generateSQL(doc)).toBeNull();
    }
  });

  it("escapes embedded identifier quotes per component", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable('odd"table', "audit");
    doc.setSelectColumns(['quoted"column']);
    const display = displayOf(doc);
    expect(display).toContain('SELECT "quoted""column"');
    expect(display).toContain('FROM "audit"."odd""table"');
  });

  it("uses canonical SQL order regardless of the order clauses were added", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("limit");
    doc.setLimitText("10");
    doc.addClause("orderBy");
    doc.setOrderBy("created_at", "desc");
    doc.addClause("from");
    doc.setFromTableText("orders");
    const display = displayOf(doc);
    expect(display.indexOf("FROM")).toBeLessThan(display.indexOf("ORDER BY"));
    expect(display.indexOf("ORDER BY")).toBeLessThan(display.indexOf("LIMIT"));
  });

  it("drops a LIMIT below 1 from the generated SQL", () => {
    const doc = selectFrom("orders");
    doc.addClause("limit");
    doc.setLimitText("0");
    expect(displayOf(doc)).not.toContain("LIMIT");
  });

  it("falls back to SELECT * when every named column is blank", () => {
    const doc = selectFrom("orders");
    doc.setSelectColumns(["   ", ""]);
    expect(displayOf(doc).startsWith("SELECT *")).toBe(true);
  });

  it("never emits an unrepresentable LIMIT", () => {
    const doc = selectFrom("orders");
    doc.addClause("limit");
    doc.setLimitText("1".padEnd(40, "0"));
    const display = displayOf(doc);
    expect(display).not.toContain("e+");
    expect(display).not.toContain("LIMIT");
  });
});

// Spec §6.3: identifiers cannot be parameterized, so quoteIdentifier stays on
// the security-critical path in both outputs and gets adversarial cases of its own.
describe("quoteIdentifier — adversarial input", () => {
  it("doubles embedded double quotes", () => {
    expect(quoteIdentifier("plain")).toBe('"plain"');
    expect(quoteIdentifier('odd"table')).toBe('"odd""table"');
    expect(quoteIdentifier('""')).toBe('""""""');
  });

  it("leaves backslashes alone — they are not identifier metacharacters in Postgres", () => {
    expect(quoteIdentifier("back\\slash")).toBe('"back\\slash"');
    expect(quoteIdentifier("trailing\\")).toBe('"trailing\\"');
  });

  it("cannot be escaped out of by a quote-plus-SQL payload", () => {
    const attack = 'users"; DROP TABLE users; --';
    const quoted = quoteIdentifier(attack);
    expect(quoted).toBe('"users""; DROP TABLE users; --"');
    // Exactly two unescaped quotes: the opening and closing delimiters.
    expect(quoted.replaceAll('""', "")).toBe('"users; DROP TABLE users; --"');
  });

  it("preserves unicode, newlines, and null-ish text verbatim", () => {
    expect(quoteIdentifier("café")).toBe('"café"');
    expect(quoteIdentifier("日本語")).toBe('"日本語"');
    expect(quoteIdentifier("emoji_🐉")).toBe('"emoji_🐉"');
    expect(quoteIdentifier("line\nbreak")).toBe('"line\nbreak"');
    expect(quoteIdentifier("nul\0byte")).toBe('"nul\0byte"');
  });

  it("quotes an empty identifier rather than producing bare quotes elsewhere", () => {
    expect(quoteIdentifier("")).toBe('""');
  });
});

describe("escapeLikePattern — adversarial input", () => {
  it("escapes backslash before the metacharacters it introduces", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("back\\slash")).toBe("back\\\\slash");
    // The ordering trap: escaping % first would leave \\% here.
    expect(escapeLikePattern("\\%")).toBe("\\\\\\%");
  });

  it("passes unicode through unchanged", () => {
    expect(escapeLikePattern("日本語")).toBe("日本語");
  });
});

describe("generateSQL — exec", () => {
  it("binds an equality value as $1", () => {
    const doc = selectFrom("orders");
    doc.addClause("where");
    doc.setWhereCondition("status", "equals", "paid");
    const { exec } = generateSQL(doc)!;
    expect(exec.text).toContain('"status" = $1');
    expect(exec.params).toEqual(["paid"]);
  });

  it("keeps LIKE escaping in the parameter but not quote-doubling", () => {
    const doc = selectFrom("orders");
    doc.addClause("where");
    doc.setWhereCondition("name", "contains", "O'Brien%");
    const { exec } = generateSQL(doc)!;
    expect(exec.text).toContain('"name" LIKE $1');
    expect(exec.text).toContain("ESCAPE '\\'");
    expect(exec.params).toEqual(["%O'Brien\\%%"]);
  });

  it("emits no parameter for isEmpty", () => {
    const doc = selectFrom("orders");
    doc.addClause("where");
    doc.setWhereCondition("email", "isEmpty", null);
    const { exec } = generateSQL(doc)!;
    expect(exec.text).toContain('"email" IS NULL');
    expect(exec.params).toEqual([]);
  });

  it("inlines LIMIT rather than binding it", () => {
    const doc = selectFrom("orders");
    doc.addClause("limit");
    doc.setLimitText("20");
    const { exec } = generateSQL(doc)!;
    expect(exec.text).toContain("LIMIT 20");
    expect(exec.params).toEqual([]);
  });

  it("keeps identifiers quoted in exec, since they cannot be parameterized", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("select");
    doc.addClause("from");
    doc.selectFromTable('odd"table', "audit");
    const { exec } = generateSQL(doc)!;
    expect(exec.text).toContain('FROM "audit"."odd""table"');
    expect(exec.params).toEqual([]);
  });

  it("produces no parameters for a query without WHERE", () => {
    const { exec } = generateSQL(selectFrom("orders"))!;
    expect(exec.text).toBe('SELECT * FROM "orders"');
    expect(exec.params).toEqual([]);
  });

  it("leaves CREATE TABLE identical in both outputs", () => {
    const doc = new QueryDocument();
    doc.chooseStatement("createTable");
    doc.setCreateTableName("notes");
    doc.setCreateColumns([{ name: "body", type: "text" }]);
    const sql = generateSQL(doc)!;
    expect(sql.exec.text).toBe(sql.display);
    expect(sql.exec.params).toEqual([]);
  });

  it("keeps display and exec structurally aligned apart from the placeholder", () => {
    const doc = selectFrom("orders");
    doc.addClause("where");
    doc.setWhereCondition("status", "equals", "paid");
    const { display, exec } = generateSQL(doc)!;
    expect(display).toContain("'paid'");
    expect(exec.text).not.toContain("'paid'");
    // Function replacement, so the `$1` is never read as a capture reference.
    expect(display.replace("'paid'", () => "$1")).toBe(exec.text);
  });
});
