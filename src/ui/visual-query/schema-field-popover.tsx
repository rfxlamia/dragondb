import { useMemo, useState } from "react";
import { VisualQueryAccessibility } from "./accessibility";
import { VisualQueryCopy } from "./copy";
import "./visual-query.css";

export type SchemaFieldPopoverProps<T> = {
  title: string;
  items: T[];
  itemTitle: (item: T) => string;
  /** Stable list identity; defaults to `itemTitle` (unsafe when titles collide). */
  itemKey?: (item: T) => string;
  needsFromMessage?: string | null;
  errorMessage?: string | null;
  onSelect: (item: T) => void;
};

export function schemaPopoverEmptyStateMessage(args: {
  itemsAreEmpty: boolean;
  needsFromMessage?: string | null;
  errorMessage?: string | null;
}): string | null {
  if (!args.itemsAreEmpty) {
    return null;
  }
  return args.needsFromMessage ?? args.errorMessage ?? null;
}

export function SchemaFieldPopover<T>(props: SchemaFieldPopoverProps<T>): React.JSX.Element {
  const { title, items, itemTitle, itemKey, needsFromMessage, errorMessage, onSelect } = props;
  const [searchText, setSearchText] = useState("");
  const keyOf = itemKey ?? itemTitle;

  const emptyStateMessage = schemaPopoverEmptyStateMessage({
    itemsAreEmpty: items.length === 0,
    needsFromMessage,
    errorMessage,
  });

  const filteredItems = useMemo(() => {
    const trimmed = searchText.trim();
    if (trimmed.length === 0) {
      return items;
    }
    const needle = trimmed.toLowerCase();
    return items.filter((item) => itemTitle(item).toLowerCase().includes(needle));
  }, [items, itemTitle, searchText]);

  return (
    <div className="vq-popover">
      <div className="vq-popover__title">{title}</div>

      <input
        className="vq-popover__search"
        type="text"
        placeholder="Search"
        value={searchText}
        onChange={(event) => setSearchText(event.target.value)}
        data-testid={VisualQueryAccessibility.schemaPopoverSearch}
      />

      {emptyStateMessage ? (
        <div className="vq-popover__message">{emptyStateMessage}</div>
      ) : filteredItems.length === 0 ? (
        <div className="vq-popover__message">{VisualQueryCopy.noMatchesTitle}</div>
      ) : (
        <div className="vq-popover__list" data-testid={VisualQueryAccessibility.schemaPopoverList}>
          {filteredItems.map((item) => (
            <button
              key={keyOf(item)}
              type="button"
              className="vq-popover__item"
              onClick={() => onSelect(item)}
              data-testid={VisualQueryAccessibility.schemaPopoverItem(title, keyOf(item))}
            >
              {itemTitle(item)}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
