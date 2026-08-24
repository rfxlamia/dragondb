/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { UNREADABLE_EXPORT_SENTINEL } from "../../../src/lib/result-cell";
import { compactCell } from "../../../src/lib/result-compactor";
import { JsonViewer } from "../../../src/ui/results/json-viewer";
import { ResultsCopy } from "../../../src/ui/results/results-copy";
import { resultRows } from "../../lib/result-fixture";

afterEach(() => cleanup());

describe("JsonViewer", () => {
  it("renders raw values, not compact truncated cells", () => {
    const raw = "x".repeat(3000);
    const compact = compactCell(raw);
    expect(compact).not.toBe(raw);
    render(<JsonViewer columns={["body"]} rows={resultRows([[raw]])} />);
    expect(screen.getByText(new RegExp(raw.slice(0, 40)))).toBeInTheDocument();
    expect(screen.queryByText(compact)).toBeNull();
  });

  it("Copy JSON keeps exact values and names unreadable", async () => {
    const user = userEvent.setup();
    const writeText = vi.spyOn(navigator.clipboard, "writeText").mockResolvedValue(undefined);
    const columnTypes = [
      { name: "id", typeName: "int8", typeOid: 20 },
      { name: "qty", typeName: "int4", typeOid: 23 },
      { name: "active", typeName: "bool", typeOid: 16 },
      { name: "price", typeName: "numeric", typeOid: 1700 },
      { name: "note", typeName: "text", typeOid: 25 },
      { name: "secret", typeName: "bytea", typeOid: 17 },
    ];
    const rows = resultRows([
      ["9223372036854775807", 42, true, "19.99", null, { state: "unreadable", typeName: "bytea" }],
    ]);
    render(
      <JsonViewer
        columns={["id", "qty", "active", "price", "note", "secret"]}
        columnTypes={columnTypes}
        rows={rows}
      />,
    );
    await user.click(screen.getByRole("button", { name: ResultsCopy.copyJson }));
    expect(writeText).toHaveBeenCalledTimes(1);
    const copied = writeText.mock.calls[0]?.[0];
    expect(copied).toBeDefined();
    expect(copied).not.toContain("[object Object]");
    const parsed = JSON.parse(copied!) as Record<string, unknown>[];
    expect(parsed[0]?.id).toBe("9223372036854775807");
    expect(parsed[0]?.qty).toBe(42);
    expect(parsed[0]?.active).toBe(true);
    expect(parsed[0]?.price).toBe("19.99");
    expect(parsed[0]?.note).toBeNull();
    expect(parsed[0]?.secret).toBe(UNREADABLE_EXPORT_SENTINEL);
  });

  it("shows Copied only after clipboard.writeText succeeds", async () => {
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValueOnce(new Error("denied"));
    render(<JsonViewer columns={["id"]} rows={resultRows([[1]])} />);
    await user.click(screen.getByRole("button", { name: ResultsCopy.copyJson }));
    expect(screen.getByRole("button", { name: ResultsCopy.copyJson })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: ResultsCopy.copied })).toBeNull();
  });
});
