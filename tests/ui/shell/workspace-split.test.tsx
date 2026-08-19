/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ResultsAccessibility } from "../../../src/ui/results/results-accessibility";
import { WorkspaceSplit } from "../../../src/ui/shell/workspace-split";

afterEach(() => {
  cleanup();
});

describe("WorkspaceSplit", () => {
  it("keeps a 400px overflow-auto scrollport while the inner root is at least 550px", () => {
    const { container } = render(
      <div style={{ overflow: "auto", height: "400px" }} data-testid="scrollport">
        <div style={{ minHeight: 550 }} data-testid="split-root">
          <WorkspaceSplit
            canvas={<div data-testid="canvas-slot">canvas</div>}
            results={<div data-testid="results-slot">results</div>}
          />
        </div>
      </div>,
    );
    const scrollport = screen.getByTestId("scrollport");
    expect(scrollport.style.overflow).toBe("auto");
    expect(scrollport.style.height).toBe("400px");
    expect(screen.getByTestId("split-root").style.minHeight).toBe("550px");
    expect(screen.getByTestId("canvas-slot")).toBeInTheDocument();
    expect(screen.getByTestId("results-slot")).toBeInTheDocument();
    expect(screen.getByTestId(ResultsAccessibility.splitSeparator)).toBeInTheDocument();
    expect(container.querySelector("[data-min-canvas='250']")).not.toBeNull();
    expect(container.querySelector("[data-min-results='300']")).not.toBeNull();
  });

  it("App.css gives the shell a scrollport and the main column a 550px floor", () => {
    const css = readFileSync(join(process.cwd(), "src/App.css"), "utf8");
    expect(css).toMatch(/\.app-main-column\s*\{[^}]*min-height:\s*550px/);
    expect(css).toMatch(/\.app-shell\s*\{[^}]*overflow:\s*auto/);
    expect(css).not.toMatch(/\.app-main-column\s*\{[^}]*height:\s*100vh/);
    expect(css).not.toMatch(/\.app-main-column\s*\{[^}]*overflow:\s*hidden/);
  });

  it("does not persist layout to localStorage", () => {
    const setItem = vi.spyOn(Storage.prototype, "setItem");
    const src = readFileSync(join(process.cwd(), "src/ui/shell/workspace-split.tsx"), "utf8");
    render(
      <div style={{ overflow: "auto", height: "400px" }}>
        <WorkspaceSplit canvas={<div>c</div>} results={<div>r</div>} />
      </div>,
    );
    expect(setItem).not.toHaveBeenCalled();
    expect(src).not.toMatch(/localStorage/);
    expect(src).not.toMatch(/onLayoutChanged/);
    setItem.mockRestore();
  });
});
