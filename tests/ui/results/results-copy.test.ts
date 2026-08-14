import { describe, expect, it } from "vitest";
import { ResultsCopy } from "../../../src/ui/results/results-copy";

describe("ResultsCopy", () => {
  it("matches Swift empty/loading/error copy", () => {
    expect(ResultsCopy.runQueryEmpty).toBe("Run a query to see results");
    expect(ResultsCopy.noRowsFound).toBe("No rows found");
    expect(ResultsCopy.loadingResults).toBe("Loading results...");
    expect(ResultsCopy.queryFailedTitle).toBe("Query Failed");
    expect(ResultsCopy.nullToken).toBe("NULL");
  });
});
