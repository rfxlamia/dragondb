import { describe, expect, it } from "vitest";
import {
  initialCreateDatabaseFlow,
  reduceCreateDatabaseFlow,
} from "../../../src/ui/connection/create-database-flow";

describe("create database flow", () => {
  it("returns a create failure to editing without losing the name", () => {
    const creating = reduceCreateDatabaseFlow(initialCreateDatabaseFlow, {
      type: "submit",
      name: "shop",
    });
    expect(
      reduceCreateDatabaseFlow(creating, {
        type: "createFailed",
        message: "permission denied",
      }),
    ).toMatchObject({ phase: "editing", name: "shop", createError: "permission denied" });
  });

  it("commits create before allowing one explicit connect", () => {
    let state = reduceCreateDatabaseFlow(initialCreateDatabaseFlow, {
      type: "submit",
      name: "shop",
    });
    expect(state).toMatchObject({ phase: "creating", name: "shop" });
    expect(reduceCreateDatabaseFlow(state, { type: "submit", name: "shop" })).toBe(state);

    state = reduceCreateDatabaseFlow(state, { type: "createSucceeded" });
    state = reduceCreateDatabaseFlow(state, {
      type: "refreshFailed",
      message: "catalog unavailable",
    });
    expect(state).toMatchObject({ phase: "created", name: "shop" });
    expect(reduceCreateDatabaseFlow(state, { type: "submit", name: "shop" })).toBe(state);

    state = reduceCreateDatabaseFlow(state, { type: "connectRequested" });
    expect(state.phase).toBe("connecting");
    state = reduceCreateDatabaseFlow(state, {
      type: "connectFailed",
      message: "offline",
    });
    expect(state).toMatchObject({ phase: "created", name: "shop", connectError: "offline" });
  });
});
