import type { QueryFolderDto } from "../../ipc/contract";
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
      <div className="queries-column__folder-row">
        <button
          type="button"
          className="queries-column__disclosure"
          aria-expanded={expanded}
          aria-label={expanded ? QueriesCopy.collapseFolder : QueriesCopy.expandFolder}
          onClick={onToggleExpanded}
        />
        <h3 className="queries-column__folder-name">{folder.name}</h3>
        {onRenameFolder ? (
          <button type="button" onClick={onRenameFolder}>
            {QueriesCopy.renameFolder}
          </button>
        ) : null}
        <button type="button" onClick={onDeleteFolder}>
          {QueriesCopy.deleteFolder}
        </button>
      </div>
      {expanded ? <ul className="queries-column__folder-queries">{children}</ul> : null}
    </div>
  );
}
