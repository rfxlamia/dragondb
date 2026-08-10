import type { StatementKind } from "../../core";
import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

export function StatementPicker(props: {
  onChoose: (kind: StatementKind) => void;
}): React.JSX.Element {
  const { onChoose } = props;

  return (
    <div
      className="vq-statement-menu"
      data-testid={VisualQueryAccessibility.statementMenu}
    >
      {VisualQueryCopy.statementMenuItems().map((item) => (
        <button
          key={item.kind}
          type="button"
          className="vq-statement-menu__item"
          onClick={() => onChoose(item.kind)}
          data-testid={VisualQueryAccessibility.statementMenuItem(item.kind)}
        >
          <div className="vq-statement-menu__item-header">
            <span className="vq-statement-menu__item-title">{item.title}</span>
            {item.badge ? (
              <span className="vq-statement-menu__item-badge">{item.badge}</span>
            ) : null}
          </div>
          <span className="vq-statement-menu__item-helper">{item.helper}</span>
        </button>
      ))}
    </div>
  );
}
