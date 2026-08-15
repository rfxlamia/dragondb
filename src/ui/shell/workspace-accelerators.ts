export type MenuEventId = "help" | "shortcuts" | "settings" | "new-tab" | "close-tab" | "run-query";

export type WorkspaceAccelContext = {
  newTab: () => void;
  closeTab: () => void;
  runQuery: () => void;
  canRun: () => boolean;
  welcome: boolean;
  openHelp: () => void;
  openShortcuts: () => void;
  openSettings: () => void;
};

export type AccelGlyphs = {
  newTab: string;
  closeTab: string;
  runQuery: string;
};

export function accelGlyphs(platform: string): AccelGlyphs {
  if (platform.startsWith("Mac")) {
    return { newTab: "⌘T", closeTab: "⌘W", runQuery: "⌘↵" };
  }
  return { newTab: "Ctrl+T", closeTab: "Ctrl+W", runQuery: "Ctrl+Enter" };
}

export function isTauriRuntime(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  if (tag === "INPUT" || tag === "TEXTAREA") return true;
  return target.isContentEditable;
}

function isAccel(event: KeyboardEvent): boolean {
  return event.metaKey || event.ctrlKey;
}

export function handleWorkspaceKeydown(event: KeyboardEvent, ctx: WorkspaceAccelContext): void {
  if (!isAccel(event) || isEditableTarget(event.target)) return;
  const key = event.key.length === 1 ? event.key.toLowerCase() : event.key;
  if (key === "t") {
    if (ctx.welcome) return;
    event.preventDefault();
    ctx.newTab();
    return;
  }
  if (key === "w") {
    if (ctx.welcome) return;
    event.preventDefault();
    ctx.closeTab();
    return;
  }
  if (key === "Enter") {
    if (ctx.welcome) return;
    event.preventDefault();
    if (ctx.canRun()) ctx.runQuery();
  }
}

export function handleMenuEvent(id: string, ctx: WorkspaceAccelContext): void {
  switch (id) {
    case "help":
      ctx.openHelp();
      return;
    case "shortcuts":
      ctx.openShortcuts();
      return;
    case "settings":
      ctx.openSettings();
      return;
    case "new-tab":
      if (!ctx.welcome) ctx.newTab();
      return;
    case "close-tab":
      if (!ctx.welcome) ctx.closeTab();
      return;
    case "run-query":
      if (!ctx.welcome && ctx.canRun()) ctx.runQuery();
  }
}
