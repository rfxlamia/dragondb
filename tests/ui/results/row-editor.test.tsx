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
    expect(onSubmit).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("Nothing changed");
  });

  describe("only changed columns are sent", () => {
    const editColumns = [
      column({ name: "name" }),
      column({ name: "created_at", dataType: "date" }),
      column({ name: "note", isNullable: true }),
    ];

    it("sends only the column the user edited", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <RowEditor
          selectedCount={1}
          columns={editColumns}
          values={["ada", "2026-08-03", "hello"]}
          onSubmit={onSubmit}
        />,
      );
      await user.clear(screen.getByLabelText("name"));
      await user.type(screen.getByLabelText("name"), "grace");
      await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({ name: "grace" });
    });

    it("does not send a column after NULL is toggled on and back off", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <RowEditor
          selectedCount={1}
          columns={editColumns}
          values={["ada", "2026-08-03", "hello"]}
          onSubmit={onSubmit}
        />,
      );
      const nullToggle = screen.getByLabelText(ResultsCopy.setNullFor("note"));
      await user.click(nullToggle);
      await user.click(nullToggle);
      await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("Nothing changed");
    });

    it("sends NULL when the user explicitly marks a column NULL", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <RowEditor
          selectedCount={1}
          columns={editColumns}
          values={["ada", "2026-08-03", "hello"]}
          onSubmit={onSubmit}
        />,
      );
      await user.click(screen.getByLabelText(ResultsCopy.setNullFor("note")));
      await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
      expect(onSubmit).toHaveBeenCalledTimes(1);
      expect(onSubmit).toHaveBeenCalledWith({ note: null });
    });

    it("does not submit when nothing was edited", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <RowEditor
          selectedCount={1}
          columns={editColumns}
          values={["ada", "2026-08-03", "hello"]}
          onSubmit={onSubmit}
        />,
      );
      await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
      expect(onSubmit).not.toHaveBeenCalled();
      expect(screen.getByRole("status")).toHaveTextContent("Nothing changed");
    });
  });

  describe("unreadable and truncated cells cannot be edited", () => {
    const payloadColumns = [
      column({ name: "id", dataType: "bigint", isPrimaryKey: true }),
      column({ name: "payload", isNullable: true }),
      column({ name: "note" }),
    ];

    it("keeps unreadable cells read-only and out of the patch", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <RowEditor
          selectedCount={1}
          columns={payloadColumns}
          values={[1, { state: "unreadable", typeName: "bytea" }, "visible"]}
          onSubmit={onSubmit}
        />,
      );
      const payloadInput = screen.getByLabelText("payload");
      expect(payloadInput).toHaveAttribute("readonly");
      await user.click(payloadInput);
      await user.keyboard("hack");
      expect(payloadInput).toHaveValue("[unreadable]");
      expect(screen.queryByLabelText(ResultsCopy.setNullFor("payload"))).not.toBeInTheDocument();
      await user.clear(screen.getByLabelText("note"));
      await user.type(screen.getByLabelText("note"), "updated");
      await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
      expect(onSubmit).toHaveBeenCalledWith({ note: "updated" });
    });

    it("keeps truncated cells read-only and out of the patch", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      render(
        <RowEditor
          selectedCount={1}
          columns={payloadColumns}
          values={[1, { state: "truncated", text: "partial value" }, "visible"]}
          onSubmit={onSubmit}
        />,
      );
      const payloadInput = screen.getByLabelText("payload");
      expect(payloadInput).toHaveAttribute("readonly");
      await user.click(payloadInput);
      await user.keyboard("more");
      expect(payloadInput).toHaveValue("partial value... [truncated]");
      expect(screen.queryByLabelText(ResultsCopy.setNullFor("payload"))).not.toBeInTheDocument();
      await user.clear(screen.getByLabelText("note"));
      await user.type(screen.getByLabelText("note"), "updated");
      await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
      expect(onSubmit).toHaveBeenCalledWith({ note: "updated" });
    });

    it("preserves an int8 primary key at 64-bit max exactly", async () => {
      const user = userEvent.setup();
      const onSubmit = vi.fn();
      const int8Max = "9223372036854775807";
      render(
        <RowEditor
          selectedCount={1}
          columns={[
            column({ name: "id", dataType: "bigint", isPrimaryKey: true }),
            column({ name: "label" }),
          ]}
          values={[
            { state: "value", text: int8Max },
            { state: "value", text: "edge" },
          ]}
          onSubmit={onSubmit}
        />,
      );
      const pkInput = screen.getByLabelText("id");
      expect(pkInput).toHaveAttribute("readonly");
      expect(pkInput).toHaveValue(int8Max);
      await user.clear(screen.getByLabelText("label"));
      await user.type(screen.getByLabelText("label"), "updated");
      await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
      expect(onSubmit).toHaveBeenCalledWith({ label: "updated" });
      expect(pkInput).toHaveValue(int8Max);
    });
  });

  it("keeps a failed draft and blocks duplicate Save while pending", async () => {
    let rejectSave!: (reason: unknown) => void;
    const onSubmit = vi.fn(
      () =>
        new Promise<void>((_resolve, reject) => {
          rejectSave = reject;
        }),
    );
    const user = userEvent.setup();
    render(
      <RowEditor
        selectedCount={1}
        columns={[
          column({ name: "occurred_on", dataType: "date" }),
          column({ name: "note", isNullable: true }),
        ]}
        values={["2026-08-18", "launch"]}
        onSubmit={onSubmit}
        onCancel={vi.fn()}
      />,
    );
    await user.clear(screen.getByLabelText("occurred_on"));
    await user.type(screen.getByLabelText("occurred_on"), "2026-08-19");
    await user.clear(screen.getByLabelText("note"));
    await user.type(screen.getByLabelText("note"), "retry me");
    await user.click(screen.getByRole("button", { name: ResultsCopy.save }));
    await user.keyboard("{Enter}");
    expect(onSubmit).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("button", { name: ResultsCopy.save })).toBeDisabled();
    expect(screen.getByRole("button", { name: ResultsCopy.cancel })).toBeDisabled();

    rejectSave({ kind: "updateFailed", message: "denied" });
    expect(await screen.findByRole("alert")).toHaveTextContent("Your changes are still here");
    expect(screen.getByLabelText("occurred_on")).toHaveValue("2026-08-19");
    expect(screen.getByLabelText("note")).toHaveValue("retry me");
    expect(screen.getByRole("button", { name: ResultsCopy.save })).toBeEnabled();
  });
});
