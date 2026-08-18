import { useEffect, useRef } from "react";
import { useEscapeDismiss } from "../use-escape-dismiss";

/** Only one connection sheet is ever mounted, so a constant id is enough. */
const TITLE_ID = "connection-sheet-title";

/**
 * Floating shell for the connection form.
 *
 * The form used to sit inline at the bottom of the sidebar, below the table
 * list: a dozen fields and a four-button row permanently occupying the panel
 * you actually browse tables in, reachable only by scrolling past the schema.
 * Editing a connection is a discrete, occasional task, so it gets a sheet —
 * the same surface idiom the DDL / export / history dialogs already use.
 *
 * Dismissal: Cancel in the footer, or Escape — except while a confirm sits on
 * top of it (`escapeBlocked`), where Escape belongs to that confirm; closing
 * the sheet under a live confirm would leave the confirm floating with its
 * pending action still armed. The footer is sticky so Save / Connect stay
 * reachable while the field list scrolls.
 *
 * Not a focus trap and not `aria-modal`: nothing behind it is inert, so the
 * sheet does not claim containment it cannot enforce (same as the app's other
 * dialogs). Focus is moved into the first field on open and returned to the
 * opener on close, which is the part a non-trapping dialog still owes.
 */
export function ConnectionFormSheet(props: {
  title: string;
  onCancel: () => void;
  escapeBlocked?: boolean;
  /** Pinned between body and footer — test result / error stays visible while the fields scroll. */
  notice?: React.ReactNode;
  footer: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  const { title, onCancel, escapeBlocked = false, notice, footer, children } = props;
  const bodyRef = useRef<HTMLDivElement>(null);

  useEscapeDismiss(onCancel, !escapeBlocked);

  // Focus the first field on open so the sheet is typeable without a click,
  // and hand focus back to whatever opened the sheet on close — without that,
  // dismissing drops focus on <body> and a keyboard user restarts from the top
  // of the document. Capture before focusing, in this order, in one effect:
  // split across two, the capture would read the field this one just focused.
  // Sheets here are not focus traps (neither are the app's other dialogs);
  // Escape is the escape hatch.
  useEffect(() => {
    const opener = document.activeElement;
    const first = bodyRef.current?.querySelector<HTMLElement>("input, select, textarea");
    first?.focus();
    return () => {
      if (opener instanceof HTMLElement && opener.isConnected) opener.focus();
    };
  }, []);

  return (
    <div className="connection-sheet" role="dialog" aria-labelledby={TITLE_ID}>
      <h3 className="connection-sheet__title" id={TITLE_ID}>
        {title}
      </h3>
      <div className="connection-sheet__body" ref={bodyRef}>
        {children}
      </div>
      {notice ? <div className="connection-sheet__notice">{notice}</div> : null}
      <div className="connection-sheet__footer">{footer}</div>
    </div>
  );
}
