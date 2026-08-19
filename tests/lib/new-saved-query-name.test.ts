import { describe, expect, it } from "vitest";
import { newSavedQueryName } from "../../src/lib/new-saved-query-name";

describe("newSavedQueryName", () => {
  it("formats Swift yy-MM-dd H:mm:ss with a Query prefix", () => {
    expect(newSavedQueryName(new Date("2026-08-15T14:03:09"))).toMatch(/^Query 26-08-15 14:03:09$/);
  });
});
