import type { SavedQueryDto } from "../../ipc/contract";
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
          ? "queries-column__query queries-column__query--selected"
          : "queries-column__query"
      }
      aria-pressed={selected}
      onClick={(event) => onClick(event, query.id)}
    >
      <span className="queries-column__query-name">{query.name}</span>
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
