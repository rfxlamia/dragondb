import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

export function VisualQueryToolbar(props: {
  canStartOver: boolean;
  onStartOver: () => void;
}): React.JSX.Element {
  const { canStartOver, onStartOver } = props;

  return (
    <div className="vq-toolbar">
      {canStartOver ? (
        <button
          type="button"
          className="vq-toolbar__start-over"
          onClick={onStartOver}
          data-testid={VisualQueryAccessibility.startOver}
        >
          {VisualQueryCopy.startOverTitle}
        </button>
      ) : null}
    </div>
  );
}
