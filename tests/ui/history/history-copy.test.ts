import { describe, expect, it } from "vitest";
import { formatRelativeDate } from "../../../src/ui/history/history-copy";

const NOW = Date.parse("2026-08-15T12:00:00.000Z");

function isoAgo(ms: number): string {
  return new Date(NOW - ms).toISOString();
}

describe("formatRelativeDate", () => {
  it("returns just now under one minute", () => {
    expect(formatRelativeDate(isoAgo(0), NOW)).toBe("just now");
  });

  it("uses minute boundaries", () => {
    expect(formatRelativeDate(isoAgo(60_000), NOW)).toBe("1 minute ago");
    expect(formatRelativeDate(isoAgo(59 * 60_000), NOW)).toBe("59 minutes ago");
  });

  it("uses hour boundaries", () => {
    expect(formatRelativeDate(isoAgo(60 * 60_000), NOW)).toBe("1 hour ago");
    expect(formatRelativeDate(isoAgo(23 * 60 * 60_000), NOW)).toBe("23 hours ago");
  });

  it("uses day boundaries", () => {
    expect(formatRelativeDate(isoAgo(24 * 60 * 60_000), NOW)).toBe("1 day ago");
    expect(formatRelativeDate(isoAgo(29 * 24 * 60 * 60_000), NOW)).toBe("29 days ago");
  });

  it("uses month boundaries", () => {
    expect(formatRelativeDate(isoAgo(30 * 24 * 60 * 60_000), NOW)).toBe("1 month ago");
    expect(formatRelativeDate(isoAgo(330 * 24 * 60 * 60_000), NOW)).toBe("11 months ago");
  });

  it("uses year boundaries", () => {
    expect(formatRelativeDate(isoAgo(365 * 24 * 60 * 60_000), NOW)).toBe("1 year ago");
    expect(formatRelativeDate(isoAgo(730 * 24 * 60 * 60_000), NOW)).toBe("2 years ago");
  });

  it("passes through invalid dates", () => {
    expect(formatRelativeDate("not-a-date", NOW)).toBe("not-a-date");
  });
});
