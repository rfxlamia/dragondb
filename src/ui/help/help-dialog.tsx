import { HelpAccessibility } from "./help-accessibility";
import { HelpCopy } from "./help-copy";
import { HelpDialogShell } from "./help-dialog-shell";
import { ShortcutRows } from "./shortcut-rows";
import "./help.css";

export type HelpDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  platform: string;
};

export function HelpDialog(props: HelpDialogProps): React.JSX.Element | null {
  const { open, onOpenChange, platform } = props;
  if (!open) return null;
  return (
    <HelpDialogShell
      title={HelpCopy.helpTitle}
      doneTestId={HelpAccessibility.done}
      onDone={() => onOpenChange(false)}
    >
      <a
        className="help-dialog__support"
        href={HelpCopy.supportUrl}
        target="_blank"
        rel="noreferrer"
      >
        {HelpCopy.support}
      </a>
      <ShortcutRows platform={platform} />
    </HelpDialogShell>
  );
}
