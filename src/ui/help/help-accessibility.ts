/** Stable accessibility identifiers for Help, Shortcuts, and Settings dialogs. */
export const HelpAccessibility = {
  done: "help.done",
  shortcutsDone: "help.shortcutsDone",
  settingsDone: "help.settingsDone",
} as const;

export type HelpTestId = (typeof HelpAccessibility)[keyof typeof HelpAccessibility];
