import { useEffect, useRef, useState } from "react";
import { useEscapeDismiss } from "../use-escape-dismiss";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionCopy, humanIpcErrorMessage } from "./connection-copy";
import {
  initialCreateDatabaseFlow,
  reduceCreateDatabaseFlow,
} from "./create-database-flow";
import "./connection-panel.css";

function isTextEditingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) return true;
  return target.isContentEditable;
}

export function CreateDatabaseDialog(props: {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onCreate: (name: string) => void | Promise<void>;
  onConnect?: (name: string) => void | Promise<void>;
  onCancel: () => void;
}): React.JSX.Element | null {
  const { open, busy = false, error = null, onCreate, onConnect, onCancel } = props;
  const [state, setState] = useState(initialCreateDatabaseFlow);
  const stateRef = useRef(state);
  stateRef.current = state;
  const nameRef = useRef<HTMLInputElement>(null);
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const onConnectRef = useRef(onConnect);
  onConnectRef.current = onConnect;

  useEffect(() => {
    if (!open) setState(initialCreateDatabaseFlow);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    nameRef.current?.focus();
  }, [open]);

  const pending = busy || state.phase === "creating" || state.phase === "connecting";
  const created = state.phase === "created" || state.phase === "connecting";

  useEscapeDismiss(() => {
    if (!pending) onCancel();
  }, open);

  function writeName(next: string): void {
    const field = nameRef.current;
    if (field && field.value !== next) {
      field.value = next;
    }
    setState((current) => {
      const reduced = reduceCreateDatabaseFlow(current, { type: "nameChanged", name: next });
      stateRef.current = reduced;
      return reduced;
    });
  }

  function submitName(raw: string): void {
    const current = stateRef.current;
    const next = reduceCreateDatabaseFlow(current, { type: "submit", name: raw });
    if (next === current) return;
    stateRef.current = next;
    setState(next);
    void Promise.resolve(onCreateRef.current(next.name)).then(
      () => {
        setState((latest) => {
          const reduced = reduceCreateDatabaseFlow(latest, { type: "createSucceeded" });
          stateRef.current = reduced;
          return reduced;
        });
      },
      () => {
        setState((latest) => {
          const reduced = reduceCreateDatabaseFlow(latest, {
            type: "createFailed",
            message: ConnectionCopy.createDatabaseError,
          });
          stateRef.current = reduced;
          return reduced;
        });
      },
    );
  }

  useEffect(() => {
    if (!open) return;
    function onKey(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const phase = stateRef.current.phase;
      const field = nameRef.current;
      const editingElsewhere =
        isTextEditingTarget(event.target) && event.target !== field;

      if (phase === "editing" && !editingElsewhere && event.key.length === 1) {
        event.preventDefault();
        writeName((field?.value ?? stateRef.current.name) + event.key);
        return;
      }
      if (phase === "editing" && !editingElsewhere && event.key === "Backspace") {
        event.preventDefault();
        const currentValue = field?.value ?? stateRef.current.name;
        writeName(currentValue.slice(0, -1));
        return;
      }
      if (event.key !== "Enter") return;
      if (phase === "creating" || phase === "connecting") {
        event.preventDefault();
        return;
      }
      if (phase === "created") {
        if (event.target === field) event.preventDefault();
        return;
      }
      if (editingElsewhere) return;
      event.preventDefault();
      submitName(field?.value ?? stateRef.current.name);
    }
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    const submittedName = String(new FormData(event.currentTarget).get("databaseName") ?? "");
    submitName(submittedName);
  }

  function handleConnect(): void {
    const current = stateRef.current;
    const next = reduceCreateDatabaseFlow(current, { type: "connectRequested" });
    if (next === current) return;
    stateRef.current = next;
    setState(next);
    void Promise.resolve(onConnectRef.current?.(current.name)).then(
      () => undefined,
      (caught: unknown) => {
        setState((latest) => {
          const reduced = reduceCreateDatabaseFlow(latest, {
            type: "connectFailed",
            message: humanIpcErrorMessage(caught),
          });
          stateRef.current = reduced;
          return reduced;
        });
      },
    );
  }

  if (!open) return null;

  const shownError = state.connectError ?? error ?? state.createError;
  const blank = (nameRef.current?.value ?? state.name).trim() === "";

  return (
    <div
      className="connection-panel__confirm"
      role="dialog"
      aria-label={ConnectionCopy.createDatabase}
    >
      <form className="connection-panel__create-form" onSubmit={handleSubmit}>
        <label className="connection-form__field">
          <span>{ConnectionCopy.databaseName}</span>
          <input
            ref={nameRef}
            type="text"
            name="databaseName"
            defaultValue=""
            data-testid={ConnectionAccessibility.createDatabaseName}
            readOnly={created}
            autoComplete="off"
            onChange={(event) => writeName(event.target.value)}
          />
        </label>
        {created ? (
          <p
            className="connection-panel__created"
            data-testid={ConnectionAccessibility.createDatabaseCreated}
          >
            {ConnectionCopy.databaseCreated}
          </p>
        ) : null}
        {shownError ? (
          <p
            className="connection-panel__status"
            role="alert"
            data-testid={ConnectionAccessibility.createDatabaseError}
          >
            {shownError}
          </p>
        ) : null}
        <div className="connection-panel__confirm-actions">
          {created ? (
            <button
              type="button"
              className="connection-panel__primary"
              disabled={pending}
              onClick={handleConnect}
            >
              {ConnectionCopy.connect}
            </button>
          ) : (
            <button
              type="submit"
              className="connection-panel__primary"
              disabled={pending || blank}
            >
              {ConnectionCopy.create}
            </button>
          )}
          <button type="button" onClick={onCancel} disabled={pending}>
            {ConnectionCopy.cancel}
          </button>
        </div>
      </form>
    </div>
  );
}
