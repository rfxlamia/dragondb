/** @vitest-environment jsdom */
import { afterEach, describe, expect, it } from "vitest";
import {
  DATE_FORMAT_STORAGE_KEY,
  loadDateFormat,
  saveDateFormat,
} from "../../src/lib/date-format-setting";

afterEach(() => {
  localStorage.clear();
});

describe("date-format-setting", () => {
  it("defaults to iso8601 and round-trips Swift raw values through localStorage", () => {
    expect(loadDateFormat()).toBe("iso8601");
    expect(DATE_FORMAT_STORAGE_KEY).toBe("dragondb.queryResultsDateFormat");
    for (const value of ["iso8601", "iso8601DateOnly", "us", "european", "relative"] as const) {
      saveDateFormat(value);
      expect(localStorage.getItem(DATE_FORMAT_STORAGE_KEY)).toBe(value);
      expect(loadDateFormat()).toBe(value);
    }
  });
});
