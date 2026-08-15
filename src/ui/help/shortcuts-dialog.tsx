import { HelpCopy } from "./help-copy";
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
    <div className="help-dialog" role="dialog" aria-label={HelpCopy.shortcutsTitle}>
      <h2 className="help-dialog__title">{HelpCopy.shortcutsTitle}</h2>
      <ShortcutRows platform={platform} />
      <div className="help-dialog__actions">
        <button type="button" className="help-dialog__done" onClick={() => onOpenChange(false)}>
          {HelpCopy.done}
        </button>
      </div>
    </div>
  );
}
