import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

export function VisualQueryToolbar(props: {
  canStartOver: boolean;
  onStartOver: () => void;
  isConnected: boolean;
  canRunQuery: boolean;
  onRunQuery: () => void;
}): React.JSX.Element {
  const { canStartOver, onStartOver, isConnected, canRunQuery, onRunQuery } = props;
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
