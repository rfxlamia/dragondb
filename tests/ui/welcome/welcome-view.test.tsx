/** @vitest-environment jsdom */
import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WelcomeAccessibility } from "../../../src/ui/welcome/welcome-accessibility";
import { WelcomeCopy } from "../../../src/ui/welcome/welcome-copy";
import { WelcomeView } from "../../../src/ui/welcome/welcome-view";

afterEach(() => cleanup());

describe("WelcomeView", () => {
  it("renders onboarding mascot, hello heading, and Connect to Server button", async () => {
    const user = userEvent.setup();
    const onConnectToServer = vi.fn();
    render(<WelcomeView onConnectToServer={onConnectToServer} />);
    const img = screen.getByRole("img");
    expect(img.getAttribute("src")).toMatch(/onboarding\.png/);
    expect(screen.getByTestId(WelcomeAccessibility.hello)).toHaveTextContent(WelcomeCopy.hello);
    expect(screen.getByRole("button", { name: WelcomeCopy.connectToServer })).toBeInTheDocument();
    await user.click(screen.getByTestId(WelcomeAccessibility.connectToServer));
    expect(onConnectToServer).toHaveBeenCalledOnce();
  });
});
