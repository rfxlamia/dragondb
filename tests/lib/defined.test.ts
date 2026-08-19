import { describe, expect, it } from "vitest";
import { defined } from "./defined";

describe("defined", () => {
  it("returns the value when it is defined", () => {
    expect(defined("ok", "missing")).toBe("ok");
  });

  it("throws the given message when the value is undefined", () => {
    expect(() => defined<string>(undefined, "missing item")).toThrowError("missing item");
  });
});
