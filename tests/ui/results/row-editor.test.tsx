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
});
