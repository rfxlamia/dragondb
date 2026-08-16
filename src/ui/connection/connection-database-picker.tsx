import { useState } from "react";
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
      setCreateOpen(false);
    } catch {
      /* keep selected; parent snapshot unchanged */
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
      <label className="connection-form__field">
        <span>{ConnectionCopy.catalog}</span>
        <select
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
      {showPulse ? (
        <p className="connection-database-picker__pulse">{ConnectionCopy.selectDbPulse}</p>
      ) : null}
      {empty && isConnected ? (
        <p className="connection-panel__hint">{ConnectionCopy.noDatabases}</p>
      ) : null}

      <div className="connection-database-picker__actions">
        <button
          type="button"
          disabled={!isConnected}
          onClick={() => {
            setDeleteError(false);
            setCreateOpen(true);
          }}
        >
          {ConnectionCopy.createDatabase}
        </button>
        <button
          type="button"
          disabled={!isConnected || selected === null}
          onClick={() => {
            setDeleteError(false);
            setDeleteOpen(true);
          }}
        >
          {ConnectionCopy.deleteDatabase}
        </button>
      </div>

      <CreateDatabaseDialog
        open={createOpen}
        busy={busy}
        onCreate={(name) => void handleCreate(name)}
        onCancel={() => setCreateOpen(false)}
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
