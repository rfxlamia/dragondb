/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";
import { VisualQueryCopy } from "../../../src/ui/visual-query/copy";
import { GeneratedSQLPreview } from "../../../src/ui/visual-query/generated-sql-preview";

describe("GeneratedSQLPreview", () => {
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
    // leave clipboard stub; next test redefines
  });

  it("renders sql text", () => {
    render(<GeneratedSQLPreview sql={'SELECT * FROM "users"'} />);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toHaveTextContent(
      'SELECT * FROM "users"',
    );
  });

  it("renders em dash placeholder", () => {
    render(<GeneratedSQLPreview sql={VisualQueryCopy.sqlPreviewEmpty} />);
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toHaveTextContent("—");
  });

  it("Copy calls navigator.clipboard.writeText with the sql", async () => {
    const user = userEvent.setup();
    render(<GeneratedSQLPreview sql={"SELECT 1"} />);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await user.click(screen.getByTestId(VisualQueryAccessibility.copySQL));
    expect(writeText).toHaveBeenCalledWith("SELECT 1");
  });

  it("Copy still succeeds in UI when clipboard rejects", async () => {
    writeText.mockRejectedValueOnce(new Error("denied"));
    const user = userEvent.setup();
    render(<GeneratedSQLPreview sql={"SELECT 1"} />);
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText },
    });
    await user.click(screen.getByTestId(VisualQueryAccessibility.copySQL));
    expect(screen.getByTestId(VisualQueryAccessibility.generatedSQLText)).toBeInTheDocument();
  });
});
