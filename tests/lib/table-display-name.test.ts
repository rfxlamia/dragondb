import { describe, expect, it } from "vitest";
import { tableDisplayName } from "../../src/lib/table-display-name";

describe("tableDisplayName", () => {
  it("omits public schema, qualifies others, and treats null schema as the bare name", () => {
    expect(tableDisplayName({ schema: "public", name: "users" })).toBe("users");
    expect(tableDisplayName({ schema: "other", name: "orders" })).toBe("other.orders");
    expect(tableDisplayName({ schema: null, name: "t" })).toBe("t");
  });
});
