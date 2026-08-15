/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it } from "vitest";
import { loadDateFormat } from "../../../src/lib/date-format-setting";
import { HelpCopy } from "../../../src/ui/help/help-copy";
import { SettingsDialog } from "../../../src/ui/help/settings-dialog";

afterEach(() => {
  cleanup();
  localStorage.clear();
});

describe("SettingsDialog", () => {
  it("persists the selected date format radio across remount", async () => {
    const user = userEvent.setup();
    const { unmount } = render(<SettingsDialog open={true} onOpenChange={() => {}} />);
    await user.click(screen.getByLabelText(HelpCopy.dateFormatUs));
    expect(loadDateFormat()).toBe("us");
    unmount();
    render(<SettingsDialog open={true} onOpenChange={() => {}} />);
    expect(screen.getByLabelText(HelpCopy.dateFormatUs)).toBeChecked();
  });
});
