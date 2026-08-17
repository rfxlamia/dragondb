import { defaultKeymap } from "@codemirror/commands";
import { PostgreSQL, sql } from "@codemirror/lang-sql";
import { defaultHighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { Compartment, type Extension } from "@codemirror/state";
import { EditorView, keymap, lineNumbers } from "@codemirror/view";
import { useEffect, useImperativeHandle, useRef, useState } from "react";
import { SqlHatchCopy } from "./sql-hatch-copy";
import "./sql-hatch.css";

const HIGHLIGHT_MAX_CHARS = 50_000;
const CANCEL_AFTER_MS = 3_000;
const QUERY_TIMEOUT_MS = 300_000;

export function shouldHighlightSql(len: number): boolean {
  return len <= HIGHLIGHT_MAX_CHARS;
}

function highlightExtensions(): Extension {
  return [
    sql({ dialect: PostgreSQL }),
    syntaxHighlighting(defaultHighlightStyle, { fallback: true }),
  ];
}

const hatchTheme = EditorView.theme({
  "&": {
    height: "100%",
    fontSize: "13px",
    backgroundColor: "oklch(1 0 0)",
    color: "var(--neutral-900)",
  },
  ".cm-content": {
    fontFamily: "var(--font-mono)",
    caretColor: "var(--primary-600)",
  },
  ".cm-gutters": {
    backgroundColor: "var(--neutral-100)",
    borderRight: "1px solid var(--neutral-200)",
    color: "var(--neutral-600)",
  },
  "&.cm-focused": {
    outline: "2px solid var(--primary-600)",
    outlineOffset: "2px",
  },
});

export type SqlHatchProps = {
  queryText: string;
  onChange: (text: string) => void;
  onRun: (text: string) => void;
  isConnected: boolean;
  databaseName: string | null;
  /** Intentionally unread by submitRun; kept as a test-only seam proving hatch Run never falls back to generated visual SQL. */
  generatedVisualSql?: string;
  onCancel?: () => void;
  running?: boolean;
  ref?: React.Ref<SqlHatchHandle>;
};

export type SqlHatchHandle = {
  run: () => void;
};

export function SqlHatch(props: SqlHatchProps): React.JSX.Element {
  const {
    queryText,
    onChange,
    onRun,
    isConnected,
    databaseName,
    onCancel,
    running = false,
    ref,
  } = props;
  const hostRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const highlightCompartment = useRef(new Compartment());
  const highlightingRef = useRef(shouldHighlightSql(queryText.length));
  const onChangeRef = useRef(onChange);
  const onRunRef = useRef(onRun);
  const isConnectedRef = useRef(isConnected);
  const databaseNameRef = useRef(databaseName);
  const queryTextRef = useRef(queryText);
  const submitRunRef = useRef<() => void>(() => undefined);
  const [noDatabaseAlert, setNoDatabaseAlert] = useState(false);
  const [timedOut, setTimedOut] = useState(false);
  const runningStartedAt = useRef<number | null>(null);

  onChangeRef.current = onChange;
  onRunRef.current = onRun;
  isConnectedRef.current = isConnected;
  databaseNameRef.current = databaseName;

  useEffect(() => {
    queryTextRef.current = queryText;
  }, [queryText]);

  function currentBuffer(): string {
    return viewRef.current?.state.doc.toString() ?? queryTextRef.current;
  }

  function submitRun(): void {
    if (!isConnectedRef.current) return;
    if (databaseNameRef.current === null || databaseNameRef.current.length === 0) {
      setNoDatabaseAlert(true);
      return;
    }
    setNoDatabaseAlert(false);
    setTimedOut(false);
    onRunRef.current(currentBuffer());
  }
  submitRunRef.current = submitRun;

  useImperativeHandle(ref, () => ({ run: submitRun }));

  useEffect(() => {
    const host = hostRef.current;
    if (host === null) return;
    // jsdom + fake timers deadlock on CodeMirror's rAF loop; tests host via testid.
    if (typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent)) return;

    const initial = queryTextRef.current;
    try {
      const view = new EditorView({
        parent: host,
        doc: initial,
        extensions: [
          lineNumbers(),
          hatchTheme,
          keymap.of([
            ...defaultKeymap,
            {
              key: "Mod-Enter",
              run: () => {
                submitRunRef.current();
                return true;
              },
            },
          ]),
          highlightCompartment.current.of(
            shouldHighlightSql(initial.length) ? highlightExtensions() : [],
          ),
          EditorView.updateListener.of((update) => {
            if (!update.docChanged) return;
            const text = update.state.doc.toString();
            queryTextRef.current = text;
            onChangeRef.current(text);
            const should = shouldHighlightSql(text.length);
            if (should === highlightingRef.current) return;
            highlightingRef.current = should;
            // CodeMirror forbids dispatching from within updateListener (nested
            // updates). Defer the Compartment reconfigure to after this update
            // cycle completes so crossing the highlight threshold can't throw.
            const { view } = update;
            queueMicrotask(() => {
              if (viewRef.current !== view) return;
              view.dispatch({
                effects: highlightCompartment.current.reconfigure(
                  should ? highlightExtensions() : [],
                ),
              });
            });
          }),
        ],
      });
      viewRef.current = view;
      return () => {
        view.destroy();
        viewRef.current = null;
      };
    } catch {
      return undefined;
    }
  }, []);

  useEffect(() => {
    const view = viewRef.current;
    if (view === null) return;
    if (view.state.doc.toString() === queryText) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: queryText },
    });
  }, [queryText]);

  useEffect(() => {
    if (!running) {
      runningStartedAt.current = null;
      setTimedOut(false);
      return;
    }
    runningStartedAt.current = Date.now();
    const timeoutTimer = window.setTimeout(() => setTimedOut(true), QUERY_TIMEOUT_MS);
    return () => window.clearTimeout(timeoutTimer);
  }, [running]);

  useEffect(() => {
    if (!running) return;
    function cancelIfReady(): void {
      const started = runningStartedAt.current;
      if (started === null || Date.now() - started < CANCEL_AFTER_MS) return;
      onCancel?.();
    }
    function onKey(event: KeyboardEvent): void {
      if (event.key !== "Escape") return;
      cancelIfReady();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [running, onCancel]);

  return (
    <div className="sql-hatch">
      {typeof navigator !== "undefined" && /jsdom/i.test(navigator.userAgent) ? (
        <textarea
          className="sql-hatch__editor"
          data-testid="sqlHatch.editor"
          aria-label="SQL editor"
          value={queryText}
          onChange={(event) => {
            queryTextRef.current = event.target.value;
            onChange(event.target.value);
          }}
        />
      ) : (
        <div ref={hostRef} className="sql-hatch__editor" data-testid="sqlHatch.editor" />
      )}
      <div className="sql-hatch__actions">
        <button type="button" className="sql-hatch__run" onClick={submitRun}>
          {SqlHatchCopy.run}
        </button>
        {running ? (
          <button
            type="button"
            className="sql-hatch__stop"
            onClick={() => {
              const started = runningStartedAt.current;
              if (started === null || Date.now() - started < CANCEL_AFTER_MS) return;
              onCancel?.();
            }}
          >
            {SqlHatchCopy.stop}
          </button>
        ) : null}
      </div>
      {noDatabaseAlert ? (
        <p className="sql-hatch__alert" role="alert">
          {SqlHatchCopy.selectDatabaseAlert}
        </p>
      ) : null}
      {timedOut ? (
        <div
          className="sql-hatch__timeout"
          role="alertdialog"
          aria-label={SqlHatchCopy.queryTimeout}
        >
          <p>{SqlHatchCopy.queryTimeout}</p>
          <div className="sql-hatch__timeout-actions">
            <button type="button" className="sql-hatch__run" onClick={submitRun}>
              {SqlHatchCopy.tryAgain}
            </button>
            <button type="button" className="sql-hatch__stop" onClick={() => onCancel?.()}>
              {SqlHatchCopy.cancel}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
