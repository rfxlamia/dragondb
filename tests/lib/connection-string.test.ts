import { describe, expect, it } from "vitest";
import { buildConnectionString, parseConnectionString } from "../../src/lib/connection-string";

describe("parseConnectionString / buildConnectionString", () => {
  it("parses postgres URI happy path", () => {
    const parsed = parseConnectionString("postgres://admin:secret@127.0.0.1:5432/fstrack");
    expect(parsed).toMatchObject({
      host: "127.0.0.1",
      port: 5432,
      user: "admin",
      password: "secret",
      database: "fstrack",
    });
  });

  it("rejects invalid scheme and bad port with structured ParseError taxonomy", () => {
    try {
      parseConnectionString("mysql://h/db");
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: "invalidScheme" });
    }
    try {
      parseConnectionString("postgres://h:notaport/db");
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: "invalidPort" });
    }
    try {
      parseConnectionString("postgres:///db");
      expect.unreachable();
    } catch (e) {
      expect(e).toMatchObject({ code: "emptyHost" });
    }
  });

  it("parses sslmode query param when present", () => {
    const parsed = parseConnectionString("postgres://u:p@localhost:5432/db?sslmode=require");
    expect(parsed.sslmode).toBe("require");
  });

  it("buildConnectionString round-trips a valid parsed form", () => {
    const input = "postgres://admin:secret@127.0.0.1:5432/fstrack?sslmode=prefer";
    const parsed = parseConnectionString(input);
    const rebuilt = buildConnectionString(parsed);
    const again = parseConnectionString(rebuilt);
    expect(again).toMatchObject({
      host: parsed.host,
      port: parsed.port,
      user: parsed.user,
      password: parsed.password,
      database: parsed.database,
      sslmode: parsed.sslmode,
    });
  });
});
