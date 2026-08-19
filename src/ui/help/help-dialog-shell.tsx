import type { HelpTestId } from "./help-accessibility";
import { HelpCopy } from "./help-copy";

export type HelpDialogShellProps = {
  title: string;
  doneTestId: HelpTestId;
  onDone: () => void;
  children: React.ReactNode;
};

export function HelpDialogShell(props: HelpDialogShellProps): React.JSX.Element {
  const { title, doneTestId, onDone, children } = props;
  return (
    <div className="help-dialog" role="dialog" aria-label={title}>
      <h2 className="help-dialog__title">{title}</h2>
      {children}
      <div className="help-dialog__actions">
        <button
          type="button"
          className="help-dialog__done"
          data-testid={doneTestId}
          onClick={onDone}
        >
          {HelpCopy.done}
        </button>
      </div>
    </div>
  );
}
