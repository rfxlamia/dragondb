import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

export function VisualQueryToolbar(props: {
  canStartOver: boolean;
  onStartOver: () => void;
  isConnected: boolean;
  canRunQuery: boolean;
  onRunQuery: () => void;
  onViewGeneratedSQL: () => void;
  runHelpMessage: string | null;
  onHistory?: () => void;
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
  } = props;
  const runDisabled = !isConnected || !canRunQuery;

  return (
    <div className="vq-toolbar">
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
      <button
        type="button"
        className="vq-toolbar__history"
        onClick={() => onHistory?.()}
        data-testid={VisualQueryAccessibility.history}
      >
        {VisualQueryCopy.historyTitle}
      </button>
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
