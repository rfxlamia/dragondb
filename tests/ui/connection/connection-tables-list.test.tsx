/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { TABLES_LOAD_FAILED } from "../../../src/stores/schema-store";
import { ConnectionAccessibility } from "../../../src/ui/connection/connection-accessibility";
import { ConnectionCopy } from "../../../src/ui/connection/connection-copy";
import { ConnectionTablesList } from "../../../src/ui/connection/connection-tables-list";

afterEach(() => cleanup());

describe("ConnectionTablesList", () => {
  it("shows loading copy, not No tables found, while tablesLoading", () => {
    render(<ConnectionTablesList tables={[]} tablesLoading={true} tablesErrorMessage={null} />);
    expect(screen.getByTestId(ConnectionAccessibility.tablesRegion)).toHaveTextContent(
      ConnectionCopy.tablesLoading,
    );
    expect(screen.queryByText(ConnectionCopy.noTablesFound)).toBeNull();
  });

  it("lists display names and click does not call onRunQuery", async () => {
    const user = userEvent.setup();
    render(
      <ConnectionTablesList
        tables={[
          { schema: "public", name: "users" },
          { schema: "other", name: "orders" },
        ]}
        tablesLoading={false}
        tablesErrorMessage={null}
      />,
    );
    expect(screen.getByRole("button", { name: "users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "other.orders" })).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "users" }));
    expect(screen.getByRole("button", { name: "users" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "other.orders" })).toBeInTheDocument();
  });

  it("shows No tables found when the list is empty", () => {
    render(<ConnectionTablesList tables={[]} tablesLoading={false} tablesErrorMessage={null} />);
    expect(screen.getByText(ConnectionCopy.noTablesFound)).toBeInTheDocument();
  });

  it("shows fail copy and not No tables found when tables load failed", () => {
    render(
      <ConnectionTablesList
        tables={[]}
        tablesLoading={false}
        tablesErrorMessage={TABLES_LOAD_FAILED}
      />,
    );
    expect(ConnectionCopy.tablesLoadError).toBe(
      "Could not load tables. You can still type a name.",
    );
    expect(screen.getByText(ConnectionCopy.tablesLoadError)).toBeInTheDocument();
    expect(screen.queryByText(ConnectionCopy.noTablesFound)).toBeNull();
  });

  it("clears names and fail copy when rerendered empty after disconnect unmount", () => {
    const { rerender } = render(
      <ConnectionTablesList
        tables={[{ schema: "public", name: "users" }]}
        tablesLoading={false}
        tablesErrorMessage={null}
      />,
    );
    expect(screen.getByRole("button", { name: "users" })).toBeInTheDocument();
    rerender(<ConnectionTablesList tables={[]} tablesLoading={false} tablesErrorMessage={null} />);
    expect(screen.queryByRole("button", { name: "users" })).toBeNull();
  });
});
