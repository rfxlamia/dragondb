import { HelpAccessibility } from "./help-accessibility";
import { HelpCopy } from "./help-copy";
import { HelpDialogShell } from "./help-dialog-shell";
import { ShortcutRows } from "./shortcut-rows";
import "./help.css";

export type ShortcutsDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: string;
};

export function ShortcutsDialog(props: ShortcutsDialogProps): React.JSX.Element | null {
  const { open, onOpenChange, platform } = props;
  if (!open) return null;
  return (
    <HelpDialogShell
      title={HelpCopy.shortcutsTitle}
      doneTestId={HelpAccessibility.shortcutsDone}
      onDone={() => onOpenChange(false)}
    >
      <ShortcutRows platform={platform} />
    </HelpDialogShell>
  );
}
