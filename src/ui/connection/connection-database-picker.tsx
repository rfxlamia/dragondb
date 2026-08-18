import { useState } from "react";
import { DatabaseIcon, PlusIcon, TrashIcon } from "../icons";
import { ConnectionAccessibility } from "./connection-accessibility";
import { ConnectionConfirmDialog } from "./connection-confirm-dialog";
import { ConnectionCopy } from "./connection-copy";
import { CreateDatabaseDialog } from "./create-database-dialog";

export function ConnectionDatabasePicker(props: {
  isConnected: boolean;
  databases: string[];
  selected: string | null;
  onSelect: (name: string) => void;
  profileDatabase: string;
  missingFromList?: boolean;
  onCreateDatabase?: (name: string) => void | Promise<void>;
  onDeleteDatabase?: (name: string) => void | Promise<void>;
}): React.JSX.Element {
  const {
    isConnected,
    databases,
    selected,
    onSelect,
    profileDatabase,
    missingFromList = false,
    onCreateDatabase,
    onDeleteDatabase,
  } = props;
  const [createOpen, setCreateOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteError, setDeleteError] = useState(false);
  const [busy, setBusy] = useState(false);

  const empty = databases.length === 0;
  const showPulse = isConnected && (missingFromList || selected === null);

  async function handleCreate(name: string): Promise<void> {
    if (!onCreateDatabase) return;
    setBusy(true);
    try {
      await onCreateDatabase(name);
      setCreateError(null);
      setCreateOpen(false);
    } catch {
      // Keep the sheet open and selected/session unchanged; surface the failure.
      setCreateError(ConnectionCopy.createDatabaseError);
    } finally {
      setBusy(false);
    }
  }

  async function handleDelete(): Promise<void> {
    if (!onDeleteDatabase || selected === null) {
      setDeleteOpen(false);
      return;
    }
    setBusy(true);
    setDeleteError(false);
    try {
      await onDeleteDatabase(selected);
      setDeleteOpen(false);
    } catch {
      setDeleteError(true);
      setDeleteOpen(false);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="connection-database-picker" data-profile-database={profileDatabase}>
      {/* Catalog row: the live database reads as a breadcrumb the way the Swift
          app's toolbar does — glyph, value, then the two catalog actions as
          icons. It used to be a stacked label + full-width select + two text
          buttons, i.e. a form for something you change once a session. */}
      <div className="connection-database-picker__row">
        <span className="connection-database-picker__glyph">
          <DatabaseIcon size={14} />
        </span>
        <label className="connection-database-picker__label">
          <span className="ui-visually-hidden">{ConnectionCopy.catalog}</span>
          <select
            className="ui-quiet-select connection-database-picker__select"
            id={ConnectionAccessibility.databasePicker}
            data-testid={ConnectionAccessibility.databasePicker}
            disabled={!isConnected || empty}
            value={selected ?? ""}
            onChange={(event) => onSelect(event.target.value)}
          >
            {empty ? <option value="">{ConnectionCopy.noDatabases}</option> : null}
            {selected === null && !empty ? <option value="" /> : null}
            {databases.map((name) => (
              <option key={name} value={name}>
                {name}
              </option>
            ))}
          </select>
        </label>
        <div className="connection-database-picker__actions">
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn--accent"
            aria-label={ConnectionCopy.createDatabase}
            title={ConnectionCopy.createDatabase}
            disabled={!isConnected}
            onClick={() => {
              setDeleteError(false);
              setCreateError(null);
              setCreateOpen(true);
            }}
          >
            <PlusIcon />
          </button>
          <button
            type="button"
            className="ui-icon-btn ui-icon-btn--danger"
            aria-label={ConnectionCopy.deleteDatabase}
            title={ConnectionCopy.deleteDatabase}
            disabled={!isConnected || selected === null}
            onClick={() => {
              setDeleteError(false);
              setDeleteOpen(true);
            }}
          >
            <TrashIcon />
          </button>
        </div>
      </div>
      {showPulse ? (
        <p className="connection-database-picker__pulse">{ConnectionCopy.selectDbPulse}</p>
      ) : null}
      {empty && isConnected ? (
        <p className="connection-panel__hint">{ConnectionCopy.noDatabases}</p>
      ) : null}

      <CreateDatabaseDialog
        open={createOpen}
        busy={busy}
        error={createError}
        onCreate={(name) => void handleCreate(name)}
        onCancel={() => {
          setCreateError(null);
          setCreateOpen(false);
        }}
      />

      {deleteOpen ? (
        <ConnectionConfirmDialog
          title={ConnectionCopy.deleteDatabase}
          prompt={ConnectionCopy.deletePrompt}
          confirmLabel={ConnectionCopy.confirmDelete}
          busy={busy}
          onConfirm={() => void handleDelete()}
          onCancel={() => setDeleteOpen(false)}
        />
      ) : null}

      {deleteError ? (
        <p className="connection-panel__status" role="alert">
          {ConnectionCopy.deleteDatabaseError}
        </p>
      ) : null}
    </div>
  );
}
