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
  schemas?: string[];
  selectedSchema?: string | null;
  onSelectSchema?: (schema: string | null) => void;
  schemaError?: string | null;
  onDismissSchemaError?: () => void;
};

export function QueriesColumnToolbar(props: QueriesColumnToolbarProps): React.JSX.Element {
  const {
    filter,
    sort,
    onFilterChange,
    onSortChange,
    onNewQuery,
    onRefresh,
    schemas,
    selectedSchema,
    onSelectSchema,
    schemaError,
    onDismissSchemaError,
  } = props;

  return (
    <>
      <div className="queries-column__header">
        <h2>{QueriesCopy.title}</h2>
        <div className="queries-column__header-actions">
          {onRefresh ? (
            <button type="button" onClick={onRefresh}>
              {QueriesCopy.refresh}
            </button>
          ) : null}
          <button
            type="button"
            className="queries-column__new"
            data-testid={QueriesAccessibility.newQuery}
            aria-label={QueriesCopy.newQuery}
            onClick={onNewQuery}
          >
            +
          </button>
        </div>
      </div>

      {schemas !== undefined && schemas.length > 1 && onSelectSchema ? (
        <label className="queries-column__schema">
          {QueriesCopy.schema}
          <select
            data-testid={QueriesAccessibility.schemaPicker}
            value={selectedSchema ?? ""}
            onChange={(event) =>
              onSelectSchema(event.target.value === "" ? null : event.target.value)
            }
          >
            <option value="">{QueriesCopy.allSchemas}</option>
            {schemas.map((schema) => (
              <option key={schema} value={schema}>
                {schema}
              </option>
            ))}
          </select>
        </label>
      ) : null}
      {schemaError ? (
        <div className="queries-column__schema-error" role="alert">
          <p>{schemaError}</p>
          <button type="button" onClick={onDismissSchemaError}>
            {QueriesCopy.ok}
          </button>
        </div>
      ) : null}

      <input
        type="search"
        aria-label={QueriesCopy.filter}
        data-testid={QueriesAccessibility.filter}
        value={filter}
        onChange={(event) => onFilterChange(event.target.value)}
      />
      <label className="queries-column__sort">
        {QueriesCopy.sort}
        <select value={sort} onChange={(event) => onSortChange(event.target.value as QuerySortKey)}>
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
