import { describe, expect, it } from "vitest";
import { WelcomeCopy } from "../../../src/ui/welcome/welcome-copy";

describe("WelcomeCopy", () => {
  it("matches Swift hello and Connect to Server copy", () => {
    expect(WelcomeCopy.hello).toBe("Hello, and welcome!");
    expect(WelcomeCopy.connectToServer).toBe("Connect to Server...");
  });
});
