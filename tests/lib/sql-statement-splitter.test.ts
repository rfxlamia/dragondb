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
