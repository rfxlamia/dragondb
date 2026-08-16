/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { compactCell } from "../../../src/lib/result-compactor";
import { JsonViewer } from "../../../src/ui/results/json-viewer";

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
});
