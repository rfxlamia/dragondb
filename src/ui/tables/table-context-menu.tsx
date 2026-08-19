import { useEffect, useId, useRef, useState } from "react";
import { DocumentIcon, DownloadIcon, EllipsisIcon, RefreshIcon, TrashIcon } from "../icons";
import { TablesAccessibility } from "./tables-accessibility";
import { TablesCopy } from "./tables-copy";

export function TableContextMenu(props: {
  executing: boolean;
  exportDisabled?: boolean;
  onRefresh: () => void;
  onDdl: () => void;
  onExport: () => void;
  onTruncate: () => void;
  onDrop: () => void;
  truncateDisabled?: boolean;
}): React.JSX.Element {
  const {
    executing,
    exportDisabled = false,
    onRefresh,
    onDdl,
    onExport,
    onTruncate,
    onDrop,
    truncateDisabled = false,
  } = props;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuId = useId();

  useEffect(() => {
    if (!open) return;
    function onPointerDown(event: PointerEvent): void {
      if (rootRef.current?.contains(event.target as Node)) return;
      setOpen(false);
    }
    function onKeyDown(event: KeyboardEvent): void {
      if (event.key === "Escape") setOpen(false);
    }
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function run(action: () => void): void {
    setOpen(false);
    action();
  }

  return (
    <div
      className={
        open
          ? "table-list__menu ui-row-actions ui-row-actions--open"
          : "table-list__menu ui-row-actions"
      }
      ref={rootRef}
    >
      <button
        type="button"
        className="ui-icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        aria-label={TablesCopy.menu}
        onClick={() => setOpen((current) => !current)}
      >
        <EllipsisIcon size={15} />
      </button>
      {open ? (
        <div
          className="ui-menu table-list__menu-panel"
          role="menu"
          id={menuId}
          data-testid={TablesAccessibility.menu}
        >
          <button type="button" role="menuitem" disabled={executing} onClick={() => run(onRefresh)}>
            <RefreshIcon size={14} />
            {TablesCopy.refresh}
          </button>
          <button type="button" role="menuitem" disabled={executing} onClick={() => run(onDdl)}>
            <DocumentIcon size={14} />
            {TablesCopy.ddl}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={executing || exportDisabled}
            onClick={() => run(onExport)}
          >
            <DownloadIcon size={14} />
            {TablesCopy.export}
          </button>
          <button
            type="button"
            role="menuitem"
            className="ui-menu__danger"
            disabled={executing || truncateDisabled}
            onClick={() => run(onTruncate)}
          >
            <TrashIcon size={14} />
            {TablesCopy.truncate}
          </button>
          <button
            type="button"
            role="menuitem"
            className="ui-menu__danger"
            disabled={executing}
            onClick={() => run(onDrop)}
          >
            <TrashIcon size={14} />
            {TablesCopy.drop}
          </button>
        </div>
      ) : null}
    </div>
  );
}
