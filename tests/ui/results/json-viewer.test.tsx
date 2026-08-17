/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { compactCell } from "../../../src/lib/result-compactor";
import { JsonViewer } from "../../../src/ui/results/json-viewer";
import { ResultsCopy } from "../../../src/ui/results/results-copy";

afterEach(() => cleanup());

describe("JsonViewer", () => {
  it("renders raw values, not compact truncated cells", () => {
    const raw = "x".repeat(3000);
    const compact = compactCell(raw);
    expect(compact).not.toBe(raw);
    render(<JsonViewer columns={["body"]} rows={[[raw]]} />);
    expect(screen.getByText(new RegExp(raw.slice(0, 40)))).toBeInTheDocument();
    expect(screen.queryByText(compact)).toBeNull();
  });

  it("shows Copied only after clipboard.writeText succeeds", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<JsonViewer columns={["id"]} rows={[[1]]} />);
    await user.click(screen.getByRole("button", { name: ResultsCopy.copyJson }));
    expect(screen.getByRole("button", { name: ResultsCopy.copyJson })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ResultsCopy.copied })).toBeNull();
  });
});
