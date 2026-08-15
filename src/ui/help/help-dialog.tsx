import { HelpAccessibility } from "./help-accessibility";
import { HelpCopy } from "./help-copy";
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
    <div className="help-dialog" role="dialog" aria-label={HelpCopy.helpTitle}>
      <h2 className="help-dialog__title">{HelpCopy.helpTitle}</h2>
      <a
        className="help-dialog__support"
        href={HelpCopy.supportUrl}
        target="_blank"
        rel="noreferrer"
      >
        {HelpCopy.support}
      </a>
      <ShortcutRows platform={platform} />
      <div className="help-dialog__actions">
        <button
          type="button"
          className="help-dialog__done"
          data-testid={HelpAccessibility.done}
          onClick={() => onOpenChange(false)}
        >
          {HelpCopy.done}
        </button>
      </div>
    </div>
  );
}
