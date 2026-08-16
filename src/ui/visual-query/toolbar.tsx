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
      <div
        className="vq-toolbar__modes"
        role="radiogroup"
        aria-label="Editor mode"
        data-testid={VisualQueryAccessibility.modeToggle}
      >
        <label className="vq-toolbar__mode">
          <input
            type="radio"
            name="visual-query-editor-mode"
            value="visual"
            checked={editorMode === "visual"}
            onChange={() => onEditorModeChange?.("visual")}
          />
          {VisualQueryCopy.editorModeVisual}
        </label>
        <label className="vq-toolbar__mode">
          <input
            type="radio"
            name="visual-query-editor-mode"
            value="sql"
            checked={editorMode === "sql"}
            onChange={() => onEditorModeChange?.("sql")}
          />
          {VisualQueryCopy.editorModeSql}
        </label>
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
