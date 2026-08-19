import { describe, expect, it } from "vitest";
import { splitSqlStatements } from "../../src/lib/sql-statement-splitter";

describe("splitSqlStatements", () => {
  it("does not split on semicolon inside single quotes", () => {
    expect(splitSqlStatements("SELECT 'a;b'; SELECT 2")).toEqual(["SELECT 'a;b'", "SELECT 2"]);
  });

  it("does not split on semicolon inside dollar-quotes", () => {
    expect(splitSqlStatements("SELECT $$ a;b $$; SELECT 2")).toEqual([
      "SELECT $$ a;b $$",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons in -- line comments", () => {
    expect(splitSqlStatements("SELECT 1; -- trailing; still comment\nSELECT 2")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });

  it("ignores semicolons inside /* block comments */ (not only between statements)", () => {
    expect(splitSqlStatements("SELECT 1 /* semi; inside */; SELECT 2")).toEqual([
      "SELECT 1 /* semi; inside */",
      "SELECT 2",
    ]);
  });

  it("does not split on semicolon inside double-quoted identifiers", () => {
    expect(splitSqlStatements('SELECT * FROM "a;b"; SELECT 2')).toEqual([
      'SELECT * FROM "a;b"',
      "SELECT 2",
    ]);
  });

  it("treats nested PostgreSQL block comments as opaque", () => {
    expect(splitSqlStatements("/* a /* b; */ */ SELECT 1; SELECT 2")).toEqual([
      "SELECT 1",
      "SELECT 2",
    ]);
  });
});

describe("splitSqlStatements escape-string constants", () => {
  // PostgreSQL E'…' strings honour backslash escapes, so \' is an escaped quote,
  // not a terminator. Treating it as a terminator makes the following semicolon
  // look like a statement boundary and splits one statement into two.
  it("does not split on a semicolon after an escaped quote inside E'…'", () => {
    expect(splitSqlStatements("SELECT E'a\\'; b' AS x; SELECT 2")).toEqual([
      "SELECT E'a\\'; b' AS x",
      "SELECT 2",
    ]);
  });

  it("keeps a trailing backslash-escaped backslash from swallowing the closing quote", () => {
    expect(splitSqlStatements("SELECT E'a\\\\'; SELECT 2")).toEqual([
      "SELECT E'a\\\\'",
      "SELECT 2",
    ]);
  });
});
