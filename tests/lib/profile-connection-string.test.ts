import { describe, expect, it } from "vitest";
import { buildConnectionString } from "../../src/lib/connection-string";
import { profileConnectionStringForCopy } from "../../src/lib/profile-connection-string";

describe("profileConnectionStringForCopy", () => {
  it("builds a URI with YOUR_PASSWORD and never the stored secret", () => {
    const uri = profileConnectionStringForCopy({
      host: "localhost",
      port: 5432,
      username: "alice",
      database: "app",
    });
    expect(uri).toContain("YOUR_PASSWORD");
    expect(uri).toContain("alice");
    expect(uri).toContain("localhost");
    expect(uri).toContain("app");
    expect(uri).not.toMatch(/s3cret/);
    expect(uri).toBe(
      buildConnectionString({
        scheme: "postgresql",
        host: "localhost",
        port: 5432,
        user: "alice",
        password: "YOUR_PASSWORD",
        database: "app",
        queryParameters: {},
      }),
    );
  });
});
