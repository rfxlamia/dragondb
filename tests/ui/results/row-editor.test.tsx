/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ColumnInfo } from "../../../src/ipc/contract";
import { ResultsCopy } from "../../../src/ui/results/results-copy";
import { RowEditor } from "../../../src/ui/results/row-editor";

afterEach(() => cleanup());

const column = (overrides: Partial<ColumnInfo>): ColumnInfo => ({
  name: "value",
  dataType: "text",
  isNullable: false,
  defaultValue: null,
  isPrimaryKey: false,
  isUnique: false,
  isForeignKey: false,
  ...overrides,
});

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
        columns={[column({ name: "name" }), column({ name: "id", isPrimaryKey: true })]}
        values={["alice", 1]}
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

  it("renders PK, date, and nullable controls from ColumnInfo", () => {
    render(
      <RowEditor
        selectedCount={1}
        columns={[
          column({ name: "id", dataType: "bigint", isPrimaryKey: true }),
          column({ name: "occurred_on", dataType: "date" }),
          column({ name: "note", isNullable: true }),
        ]}
        values={[42, "2026-08-18", "launch"]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("id")).toBeDisabled();
    expect(screen.getByText(ResultsCopy.primaryKey)).toBeInTheDocument();
    expect(screen.getByLabelText("occurred_on")).toHaveAttribute("type", "date");
    expect(screen.getByLabelText(ResultsCopy.setNullFor("note"))).toBeInTheDocument();
  });

  it.each([
    ["date", "date", "2026-08-18"],
    ["time without time zone", "time", "10:00:00"],
    ["timestamp without time zone", "datetime-local", "2026-08-18T10:00"],
  ])("maps %s to a native %s control", (dataType, inputType, value) => {
    render(
      <RowEditor
        selectedCount={1}
        columns={[column({ name: "happened_at", dataType })]}
        values={[value]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("happened_at")).toHaveAttribute("type", inputType);
    expect(screen.getByLabelText("happened_at")).toHaveValue(value);
  });

  it.each([
    ["timetz", "2026-08-18 10:00:00+07"],
    ["time with time zone", "2026-08-18 10:00:00+07"],
    ["timestamptz", "2026-08-18 10:00:00+07"],
    ["timestamp with time zone", "2026-08-18 10:00:00+07"],
    ["mystery_type", "not a known type"],
  ])("keeps %s as exact text", (dataType, value) => {
    render(
      <RowEditor
        selectedCount={1}
        columns={[column({ name: "happened_at", dataType })]}
        values={[value]}
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.getByLabelText("happened_at")).toHaveAttribute("type", "text");
    expect(screen.getByLabelText("happened_at")).toHaveValue(value);
  });

  it("restores the last non-null draft when NULL is turned off", async () => {
    const user = userEvent.setup();
    const onSubmit = vi.fn();
    render(
      <RowEditor
        selectedCount={1}
        columns={[column({ name: "note", isNullable: true })]}
        values={["keep me"]}
        onSubmit={onSubmit}
      />,
    );
    const nullToggle = screen.getByLabelText(ResultsCopy.setNullFor("note"));
    await user.click(nullToggle);
    await user.click(nullToggle);
    expect(screen.getByLabelText("note")).toHaveValue("keep me");
    await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
    expect(onSubmit).toHaveBeenCalledWith({ note: "keep me" });
  });
});
