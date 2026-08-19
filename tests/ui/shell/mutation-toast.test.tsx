/** @vitest-environment jsdom */
import { act, cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MutationToast } from "../../../src/ui/shell/mutation-toast";

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("MutationToast", () => {
  it("shows View Table for 0-row UPDATE and auto-dismisses after 5s", async () => {
    vi.useFakeTimers();
    const onViewTable = vi.fn();
    render(
      <MutationToast
        sql="UPDATE orders SET x=1 WHERE false"
        table={{ schema: "public", name: "orders" }}
        onViewTable={onViewTable}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.getByRole("button", { name: /view table/i })).toBeInTheDocument();
    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(screen.queryByRole("button", { name: /view table/i })).toBeNull();
  });

  it("hides View Table for DROP TABLE", () => {
    render(
      <MutationToast
        sql="DROP TABLE public.temp"
        table={{ schema: "public", name: "temp" }}
        onViewTable={vi.fn()}
        onDismiss={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: /view table/i })).toBeNull();
  });

  it("View Table click selects the table and dismisses", async () => {
    const user = userEvent.setup();
    const onViewTable = vi.fn();
    const onDismiss = vi.fn();
    render(
      <MutationToast
        sql="UPDATE orders SET x=1 WHERE false"
        table={{ schema: "public", name: "orders" }}
        onViewTable={onViewTable}
        onDismiss={onDismiss}
      />,
    );
    await user.click(screen.getByRole("button", { name: /view table/i }));
    expect(onViewTable).toHaveBeenCalledWith({ schema: "public", name: "orders" });
    expect(onDismiss).toHaveBeenCalledOnce();
  });
});
