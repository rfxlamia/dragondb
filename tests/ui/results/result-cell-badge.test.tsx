/** @vitest-environment jsdom */

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { ResultColumn } from "../../../src/ipc/contract";
import { TRUNCATION_SUFFIX } from "../../../src/lib/result-compactor";
import { ResultCellBadge } from "../../../src/ui/results/result-cell-badge";
import { ResultsCopy } from "../../../src/ui/results/results-copy";
import { valueCell } from "../../lib/result-fixture";

afterEach(() => {
  cleanup();
});

const dateColumn: ResultColumn = { name: "occurred_on", typeName: "date", typeOid: 1082 };

describe("ResultCellBadge", () => {
  it("each cell state renders distinguishably", () => {
    const { rerender } = render(
      <ResultCellBadge cell={valueCell("hello")} columnMetadata={undefined} dateFormat="iso8601" />,
    );
    expect(screen.getByText("hello")).toBeInTheDocument();
    expect(screen.queryByText(ResultsCopy.unreadableBadge)).toBeNull();
    expect(document.querySelector(".query-results__cell-badge")).toBeNull();

    rerender(<ResultCellBadge cell={null} columnMetadata={undefined} dateFormat="iso8601" />);
    expect(screen.getByText(ResultsCopy.nullToken)).toBeInTheDocument();
    expect(screen.queryByText(ResultsCopy.unreadableBadge)).toBeNull();
    expect(document.querySelector(".query-results__cell-badge")).toBeNull();

    rerender(
      <ResultCellBadge
        cell={{ state: "unreadable", typeName: "bytea" }}
        columnMetadata={undefined}
        dateFormat="iso8601"
      />,
    );
    const unreadableBadge = screen.getByText(ResultsCopy.unreadableBadge);
    expect(unreadableBadge).toBeInTheDocument();
    expect(unreadableBadge).toHaveAccessibleName(ResultsCopy.unreadableAccessibleName("bytea"));
    expect(screen.queryByText(ResultsCopy.nullToken)).toBeNull();
    expect(unreadableBadge).toHaveClass("query-results__cell-badge--error");

    rerender(
      <ResultCellBadge
        cell={{ state: "truncated", text: "partial" }}
        columnMetadata={undefined}
        dateFormat="iso8601"
      />,
    );
    expect(screen.getByText("partial")).toBeInTheDocument();
    expect(screen.getByText(TRUNCATION_SUFFIX.trim())).toBeInTheDocument();
    expect(screen.getByText(TRUNCATION_SUFFIX.trim())).toHaveClass(
      "query-results__cell-badge--warning",
    );

    rerender(
      <ResultCellBadge
        cell={valueCell("2024-01-15")}
        columnMetadata={dateColumn}
        dateFormat="us"
      />,
    );
    expect(screen.getByText("1/15/2024")).toBeInTheDocument();
    expect(document.querySelector(".query-results__cell-badge")).toBeNull();
  });
});
