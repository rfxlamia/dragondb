import { useEffect, useId, useRef, useState } from "react";
import { TablesAccessibility } from "./tables-accessibility";
import { TablesCopy } from "./tables-copy";

export function TableContextMenu(props: {
  executing: boolean;
  onRefresh: () => void;
  onDdl: () => void;
  onExport: () => void;
  onTruncate: () => void;
  onDrop: () => void;
}): React.JSX.Element {
  const { executing, onRefresh, onDdl, onExport, onTruncate, onDrop } = props;
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
    <div className="table-list__menu" ref={rootRef}>
      <button
        type="button"
        className="table-list__icon-btn"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((current) => !current)}
      >
        {TablesCopy.menu}
      </button>
      {open ? (
        <div
          className="table-list__menu-panel"
          role="menu"
          id={menuId}
          data-testid={TablesAccessibility.menu}
        >
          <button type="button" role="menuitem" disabled={executing} onClick={() => run(onRefresh)}>
            {TablesCopy.refresh}
          </button>
          <button type="button" role="menuitem" disabled={executing} onClick={() => run(onDdl)}>
            {TablesCopy.ddl}
          </button>
          <button type="button" role="menuitem" disabled={executing} onClick={() => run(onExport)}>
            {TablesCopy.export}
          </button>
          <button
            type="button"
            role="menuitem"
            disabled={executing}
            onClick={() => run(onTruncate)}
          >
            {TablesCopy.truncate}
          </button>
          <button type="button" role="menuitem" disabled={executing} onClick={() => run(onDrop)}>
            {TablesCopy.drop}
          </button>
        </div>
      ) : null}
    </div>
  );
}
