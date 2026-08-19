import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

export type EditorMode = "visual" | "sql";

export function VisualQueryToolbar(props: {
  canStartOver: boolean;
  onStartOver: () => void;
  isConnected: boolean;
  canRunQuery: boolean;
  onRunQuery: () => void;
  onViewGeneratedSQL: () => void;
  runHelpMessage: string | null;
  onHistory?: () => void;
  editorMode?: EditorMode;
  onEditorModeChange?: (mode: EditorMode) => void;
}): React.JSX.Element {
  const {
    canStartOver,
    onStartOver,
    isConnected,
    canRunQuery,
    onRunQuery,
    onViewGeneratedSQL,
    runHelpMessage,
    onHistory,
    editorMode = "visual",
    onEditorModeChange,
  } = props;
  const runDisabled = !isConnected || !canRunQuery;

  return (
    <div className="vq-toolbar">
      {/* Segmented control, not stacked radio inputs: this is a two-state view
          switch on a desktop toolbar, and OS radio dots read as a settings
          form. Roles stay radiogroup/radio, so semantics (and the tests that
          query them) are unchanged; arrow keys move the selection the way a
          native radio group would. */}
      <div
        className="ui-segment"
        role="radiogroup"
        aria-label="Editor mode"
        data-testid={VisualQueryAccessibility.modeToggle}
      >
        {(["visual", "sql"] as const).map((mode) => (
          <label key={mode} className="ui-segment__item">
            {/* The input stays a real radio (native roving focus and arrow keys);
                it is only visually hidden, and the label itself is the segment. */}
            <input
              type="radio"
              className="ui-visually-hidden"
              name="visual-query-editor-mode"
              value={mode}
              checked={editorMode === mode}
              onChange={() => onEditorModeChange?.(mode)}
            />
            {mode === "visual" ? VisualQueryCopy.editorModeVisual : VisualQueryCopy.editorModeSql}
          </label>
        ))}
      </div>
      {canStartOver ? (
        <button
          type="button"
          className="vq-toolbar__start-over"
          onClick={onStartOver}
          disabled={!isConnected}
          data-testid={VisualQueryAccessibility.startOver}
        >
          {VisualQueryCopy.startOverTitle}
        </button>
      ) : null}
      {runHelpMessage ? <span className="vq-toolbar__help">{runHelpMessage}</span> : null}
      {onHistory ? (
        <button
          type="button"
          className="vq-toolbar__history"
          onClick={onHistory}
          data-testid={VisualQueryAccessibility.history}
        >
          {VisualQueryCopy.historyTitle}
        </button>
      ) : null}
      <button
        type="button"
        className="vq-toolbar__view-sql"
        onClick={onViewGeneratedSQL}
        disabled={!isConnected}
        data-testid={VisualQueryAccessibility.viewGeneratedSQL}
      >
        {VisualQueryCopy.viewGeneratedSQLTitle}
      </button>
      <button
        type="button"
        className="vq-toolbar__run"
        onClick={onRunQuery}
        disabled={runDisabled}
        data-testid={VisualQueryAccessibility.runQuery}
      >
        {VisualQueryCopy.runQueryTitle}
      </button>
    </div>
  );
}
