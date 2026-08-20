import { PlusIcon, RefreshIcon, SearchIcon } from "../icons";
import { QueriesAccessibility } from "./queries-accessibility";
import { QueriesCopy } from "./queries-copy";
import type { QuerySortKey } from "./queries-sort";

export type QueriesColumnToolbarProps = {
  filter: string;
  sort: QuerySortKey;
  onFilterChange: (value: string) => void;
  onSortChange: (value: QuerySortKey) => void;
  onNewQuery: () => void;
  onRefresh?: () => void;
};

export function QueriesColumnToolbar(props: QueriesColumnToolbarProps): React.JSX.Element {
  const { filter, sort, onFilterChange, onSortChange, onNewQuery, onRefresh } = props;

  return (
    <>
      <div className="queries-column__header">
        <div className="queries-column__header-actions">
          {onRefresh ? (
            <button
              type="button"
              className="ui-icon-btn"
              aria-label={QueriesCopy.refresh}
              title={QueriesCopy.refresh}
              onClick={onRefresh}
            >
              <RefreshIcon />
            </button>
          ) : null}
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn--accent"
            data-testid={QueriesAccessibility.newQuery}
            aria-label={QueriesCopy.newQuery}
            title={QueriesCopy.newQuery}
            onClick={onNewQuery}
          >
            <PlusIcon />
          </button>
        </div>
      </div>

      <div className="ui-search">
        <span className="ui-search__icon">
          <SearchIcon />
        </span>
        <input
          type="search"
          className="ui-search__input"
          aria-label={QueriesCopy.filter}
          placeholder={QueriesCopy.filter}
          data-testid={QueriesAccessibility.filter}
          value={filter}
          onChange={(event) => onFilterChange(event.target.value)}
        />
      </div>
      <label className="queries-column__sort">
        <span className="ui-visually-hidden">{QueriesCopy.sort}</span>
        <select
          className="ui-quiet-select"
          value={sort}
          onChange={(event) => onSortChange(event.target.value as QuerySortKey)}
        >
          <option value="name-asc">{QueriesCopy.sortNameAsc}</option>
          <option value="name-desc">{QueriesCopy.sortNameDesc}</option>
          <option value="created-desc">{QueriesCopy.sortCreatedNewest}</option>
          <option value="created-asc">{QueriesCopy.sortCreatedOldest}</option>
          <option value="updated-desc">{QueriesCopy.sortUpdatedNewest}</option>
          <option value="updated-asc">{QueriesCopy.sortUpdatedOldest}</option>
        </select>
      </label>
    </>
  );
}
