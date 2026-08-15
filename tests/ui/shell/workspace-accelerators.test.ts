/** @vitest-environment jsdom */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  accelGlyphs,
  handleMenuEvent,
  handleWorkspaceKeydown,
} from "../../../src/ui/shell/workspace-accelerators";

function key(partial: Partial<KeyboardEvent>): KeyboardEvent {
  return {
    key: "t",
    ctrlKey: false,
    metaKey: false,
    preventDefault() {},
    ...partial,
  } as KeyboardEvent;
}

describe("workspace-accelerators", () => {
  it("accelGlyphs lists Ctrl on Win32 and glyphs on Mac", () => {
    expect(accelGlyphs("Win32")).toEqual({
      newTab: "Ctrl+T",
      closeTab: "Ctrl+W",
      runQuery: "Ctrl+Enter",
    });
    expect(accelGlyphs("Mac")).toEqual({
      newTab: "⌘T",
      closeTab: "⌘W",
      runQuery: "⌘↵",
    });
    expect(accelGlyphs("MacIntel")).toEqual({
      newTab: "⌘T",
      closeTab: "⌘W",
      runQuery: "⌘↵",
    });
  });

  it("Accel+T/W/Enter call ctx handlers; Enter no-ops when canRun is false", () => {
    let canRun = false;
    const ctx = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      runQuery: vi.fn(),
      canRun: () => canRun,
      welcome: false,
      openHelp: vi.fn(),
      openShortcuts: vi.fn(),
      openSettings: vi.fn(),
    };
    handleWorkspaceKeydown(key({ key: "t", ctrlKey: true }), ctx);
    handleWorkspaceKeydown(key({ key: "w", metaKey: true }), ctx);
    handleWorkspaceKeydown(key({ key: "Enter", ctrlKey: true }), ctx);
    expect(ctx.newTab).toHaveBeenCalledOnce();
    expect(ctx.closeTab).toHaveBeenCalledOnce();
    expect(ctx.runQuery).not.toHaveBeenCalled();
    canRun = true;
    handleWorkspaceKeydown(key({ key: "Enter", ctrlKey: true }), ctx);
    expect(ctx.runQuery).toHaveBeenCalledOnce();
  });

  it("ignores accelerator keys originating from editable controls", () => {
    const ctx = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      runQuery: vi.fn(),
      canRun: () => true,
      welcome: false,
      openHelp: vi.fn(),
      openShortcuts: vi.fn(),
      openSettings: vi.fn(),
    };
    handleWorkspaceKeydown(
      key({ key: "t", ctrlKey: true, target: document.createElement("input") }),
      ctx,
    );
    expect(ctx.newTab).not.toHaveBeenCalled();
  });

  it("welcome ignores T and Enter but handleMenuEvent still opens Help", () => {
    const ctx = {
      newTab: vi.fn(),
      closeTab: vi.fn(),
      runQuery: vi.fn(),
      canRun: () => true,
      welcome: true,
      openHelp: vi.fn(),
      openShortcuts: vi.fn(),
      openSettings: vi.fn(),
    };
    handleWorkspaceKeydown(key({ key: "t", ctrlKey: true }), ctx);
    handleWorkspaceKeydown(key({ key: "Enter", ctrlKey: true }), ctx);
    expect(ctx.newTab).not.toHaveBeenCalled();
    expect(ctx.runQuery).not.toHaveBeenCalled();
    handleMenuEvent("help", ctx);
    expect(ctx.openHelp).toHaveBeenCalledOnce();
  });

  it("src-tauri lib.rs registers CmdOrCtrl accelerators", () => {
    const src = readFileSync(join(process.cwd(), "src-tauri/src/lib.rs"), "utf8");
    expect(src).toMatch(/CmdOrCtrl\+T/);
    expect(src).toMatch(/CmdOrCtrl\+W/);
    expect(src).toMatch(/\.accelerator\("CmdOrCtrl\+Enter"\)/);
  });
});
