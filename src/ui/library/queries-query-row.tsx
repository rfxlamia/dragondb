import type { SavedQueryDto } from "../../ipc/contract";
import { DocumentIcon } from "../icons";
import { QueriesAccessibility } from "./queries-accessibility";

export type QueriesQueryRowProps = {
  query: SavedQueryDto;
  selected: boolean;
  picked: boolean;
  cached: boolean;
  executing: boolean;
  onClick: (event: React.MouseEvent, queryId: string) => void;
};

export function QueriesQueryRow(props: QueriesQueryRowProps): React.JSX.Element {
  const { query, selected, picked, cached, executing, onClick } = props;
  return (
    <button
      type="button"
      className={
        selected || picked
          ? "ui-row ui-row--selected queries-column__query"
          : "ui-row queries-column__query"
      }
      aria-pressed={selected}
      onClick={(event) => onClick(event, query.id)}
    >
      <span className="ui-row__glyph">
        <DocumentIcon size={14} />
      </span>
      <span className="ui-row__label queries-column__query-name">{query.name}</span>
      {cached ? (
        <span
          className="queries-column__cache-dot"
          data-testid={QueriesAccessibility.cacheDot(query.id)}
          aria-hidden="true"
        />
      ) : null}
      {executing ? (
        <span
          className="queries-column__spinner"
          data-testid={QueriesAccessibility.executing(query.id)}
          aria-hidden="true"
        />
      ) : null}
    </button>
  );
}
