/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";
import { GeneratedSQLDialog } from "../../../src/ui/visual-query/generated-sql-dialog";

describe("GeneratedSQLDialog", () => {
  const writeText = vi.fn().mockResolvedValue(undefined);

  beforeEach(() => {
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    writeText.mockClear();
  });

  afterEach(() => {
    cleanup();
  });

  it("shows display SQL, copies it, and Done dismisses without swapping Copy", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<GeneratedSQLDialog sql={'SELECT * FROM "users"'} onDismiss={onDismiss} />);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByText(VisualQueryCopy.viewGeneratedSQLTitle)).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toHaveTextContent(
      'SELECT * FROM "users"',
    );
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await user.click(screen.getByTestId(VisualQueryAccessibility.copySQL));
    expect(writeText).toHaveBeenCalledWith('SELECT * FROM "users"');
    expect(screen.getByTestId(VisualQueryAccessibility.copySQL)).toHaveTextContent(
      VisualQueryCopy.copySQLTitle,
    );
    const done = screen.getByTestId(VisualQueryAccessibility.generatedSQLDone);
    expect(done).toHaveTextContent(VisualQueryCopy.generatedSQLDoneTitle);
    await user.click(done);
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("renders em dash and disables Copy; Done still dismisses", async () => {
    const user = userEvent.setup();
    const onDismiss = vi.fn();
    render(<GeneratedSQLDialog sql={VisualQueryCopy.sqlPreviewEmpty} onDismiss={onDismiss} />);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toHaveTextContent("—");
    expect(screen.getByTestId(VisualQueryAccessibility.copySQL)).toBeDisabled();
    await user.click(screen.getByTestId(VisualQueryAccessibility.generatedSQLDone));
    expect(onDismiss).toHaveBeenCalledOnce();
  });

  it("keeps Copy available and the dialog open when clipboard access rejects", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const user = userEvent.setup();
    render(<GeneratedSQLDialog sql="SELECT 1" onDismiss={() => {}} />);
    await user.click(screen.getByTestId(VisualQueryAccessibility.copySQL));
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(screen.getByTestId(VisualQueryAccessibility.copySQL)).toHaveTextContent(
      VisualQueryCopy.copySQLTitle,
    );
    expect(screen.queryByTestId(VisualQueryAccessibility.generatedSQLDone)).toBeInTheDocument();
  });
});
