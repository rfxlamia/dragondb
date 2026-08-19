/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
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

  it("names the region with aria-labelledby on the heading, not a duplicate aria-label", () => {
    render(<WelcomeView onConnectToServer={vi.fn()} />);
    const region = screen.getByRole("region", { name: WelcomeCopy.hello });
    expect(region).toHaveAttribute("aria-labelledby", "welcome-hello");
    expect(region).not.toHaveAttribute("aria-label");
    expect(screen.getByTestId(WelcomeAccessibility.hello)).toHaveAttribute("id", "welcome-hello");
  });

  it("fills the welcome parent with height 100% instead of a second 100vh", () => {
    const css = readFileSync(join(process.cwd(), "src/ui/welcome/welcome.css"), "utf8");
    const block = css.match(/\.welcome-view\s*\{[^}]*\}/)?.[0];
    expect(block).toMatch(/height:\s*100%/);
    expect(block).not.toMatch(/100vh/);
  });
});
