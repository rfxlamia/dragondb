/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultsCopy } from "../../../src/ui/results/results-copy";
import { RowEditor } from "../../../src/ui/results/row-editor";

afterEach(() => cleanup());

describe("RowEditor", () => {
  it("shows Multiple Rows Selected when two rows are chosen for Edit", () => {
    render(<RowEditor selectedCount={2} onSubmit={vi.fn()} />);
    expect(screen.getByText(ResultsCopy.multipleRowsSelected)).toBeInTheDocument();
    expect(screen.getByText(ResultsCopy.selectOnlyOneRow)).toBeInTheDocument();
  });

  it("does not nest labels inside editor fields", () => {
    const { container } = render(
      <RowEditor
        selectedCount={1}
        columns={["name", "id"]}
        values={["alice", 1]}
        pkColumns={["id"]}
        onSubmit={vi.fn()}
      />,
    );
    const fields = container.querySelectorAll(".query-results__editor-field");
    expect(fields.length).toBeGreaterThan(0);
    for (const field of fields) {
      const nestedLabels = field.querySelectorAll("label label");
      expect(nestedLabels.length).toBe(0);
    }
  });
});
