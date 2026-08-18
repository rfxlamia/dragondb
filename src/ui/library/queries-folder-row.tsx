import type { QueryFolderDto } from "../../ipc/contract";
import { ChevronDownIcon, ChevronRightIcon, FolderIcon, PencilIcon, TrashIcon } from "../icons";
import { QueriesAccessibility } from "./queries-accessibility";
import { QueriesCopy } from "./queries-copy";

export type QueriesFolderRowProps = {
  folder: QueryFolderDto;
  expanded: boolean;
  onToggleExpanded: () => void;
  onDeleteFolder: () => void;
  onRenameFolder?: () => void;
  children: React.ReactNode;
};

export function QueriesFolderRow(props: QueriesFolderRowProps): React.JSX.Element {
  const { folder, expanded, onToggleExpanded, onDeleteFolder, onRenameFolder, children } = props;

  return (
    <div className="queries-column__folder" data-testid={QueriesAccessibility.folder(folder.id)}>
      <div className="queries-column__folder-row ui-row-host">
        <button
          type="button"
          className="queries-column__disclosure"
          aria-expanded={expanded}
          aria-label={expanded ? QueriesCopy.collapseFolder : QueriesCopy.expandFolder}
          onClick={onToggleExpanded}
        >
          {expanded ? <ChevronDownIcon size={13} /> : <ChevronRightIcon size={13} />}
        </button>
        <span className="queries-column__folder-glyph">
          <FolderIcon size={14} />
        </span>
        <h3 className="queries-column__folder-name">{folder.name}</h3>
        <div className="ui-row-actions">
          {onRenameFolder ? (
            <button
              type="button"
              className="ui-icon-btn"
              aria-label={QueriesCopy.renameFolder}
              title={QueriesCopy.renameFolder}
              onClick={onRenameFolder}
            >
              <PencilIcon size={14} />
            </button>
          ) : null}
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn--danger"
            aria-label={QueriesCopy.deleteFolder}
            title={QueriesCopy.deleteFolder}
            onClick={onDeleteFolder}
          >
            <TrashIcon size={14} />
          </button>
        </div>
      </div>
      {expanded ? <ul className="queries-column__folder-queries">{children}</ul> : null}
    </div>
  );
}
