import { useEffect, useRef, useState } from "react";
import { ConnectionCopy, humanIpcErrorMessage } from "./connection-copy";
import { initialCreateDatabaseFlow, reduceCreateDatabaseFlow } from "./create-database-flow";

/** Create/connect orchestration for the Create Database dialog. Not a generic async machine. */
export function useCreateDatabaseFlow(args: {
  open: boolean;
  busy?: boolean;
  error?: string | null;
  onCreate: (name: string) => void | Promise<void>;
  onConnect?: (name: string) => void | Promise<void>;
}): {
  name: string;
  pending: boolean;
  created: boolean;
  blank: boolean;
  shownError: string | null;
  changeName: (name: string) => void;
  handleSubmit: (event: React.FormEvent<HTMLFormElement>) => void;
  handleConnect: () => void;
} {
  const { open, busy = false, error = null, onCreate, onConnect } = args;
  const [state, setState] = useState(initialCreateDatabaseFlow);
  const onCreateRef = useRef(onCreate);
  onCreateRef.current = onCreate;
  const onConnectRef = useRef(onConnect);
  onConnectRef.current = onConnect;

  useEffect(() => {
    if (!open) setState(initialCreateDatabaseFlow);
  }, [open]);

  const pending = busy || state.phase === "creating" || state.phase === "connecting";
  const created = state.phase === "created" || state.phase === "connecting";
  const blank = state.name.trim() === "";
  const shownError = state.connectError ?? error ?? state.createError;

  function changeName(name: string): void {
    setState((current) => reduceCreateDatabaseFlow(current, { type: "nameChanged", name }));
  }

  function submit(): void {
    const next = reduceCreateDatabaseFlow(state, { type: "submit", name: state.name });
    if (next === state) return;
    setState(next);
    void Promise.resolve(onCreateRef.current(next.name)).then(
      () => {
        setState((latest) => reduceCreateDatabaseFlow(latest, { type: "createSucceeded" }));
      },
      () => {
        setState((latest) =>
          reduceCreateDatabaseFlow(latest, {
            type: "createFailed",
            message: ConnectionCopy.createDatabaseError,
          }),
        );
      },
    );
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>): void {
    event.preventDefault();
    submit();
  }

  function handleConnect(): void {
    const next = reduceCreateDatabaseFlow(state, { type: "connectRequested" });
    if (next === state) return;
    setState(next);
    void Promise.resolve(onConnectRef.current?.(state.name)).then(
      () => {
        setState((latest) => reduceCreateDatabaseFlow(latest, { type: "connectSucceeded" }));
      },
      (caught: unknown) => {
        setState((latest) =>
          reduceCreateDatabaseFlow(latest, {
            type: "connectFailed",
            message: humanIpcErrorMessage(caught),
          }),
        );
      },
    );
  }

  return {
    name: state.name,
    pending,
    created,
    blank,
    shownError,
    changeName,
    handleSubmit,
    handleConnect,
  };
}
