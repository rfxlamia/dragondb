import { useEffect, useRef, useState } from "react";
import type { TableReference } from "./core";
import type { DragonIpc } from "./ipc/contract";
import { createMockDragonIpc, FIXTURE_CONNECTION_ID } from "./ipc/mock";
import { coreToTableRef, tableRefToCore } from "./ipc/table-ref";
import { VisualQueryCanvas } from "./ui/visual-query/canvas";
import { VisualQueryCopy } from "./ui/visual-query/copy";
import "./App.css";

const DEFAULT_IPC: DragonIpc = createMockDragonIpc("happy");

export type AppProps = { ipc?: DragonIpc };

export default function App({ ipc = DEFAULT_IPC }: AppProps = {}) {
  const [tables, setTables] = useState<TableReference[]>([]);
  const [columnNames, setColumnNames] = useState<string[]>([]);
  const [metadataErrorMessage, setMetadataErrorMessage] = useState<string | null>(null);

  const columnGeneration = useRef(0);
  const mounted = useRef(true);

  useEffect(() => {
    let cancelled = false;
    void ipc.listTables(FIXTURE_CONNECTION_ID).then(
      (rows) => {
        if (!cancelled) setTables(rows.map(tableRefToCore));
      },
      () => {
        if (!cancelled) {
          setTables([]);
          setMetadataErrorMessage(VisualQueryCopy.tablesLoadError);
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [ipc]);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      columnGeneration.current += 1;
    };
  }, []);

  function handleCommittedFromChange(table: TableReference | null): void {
    const generation = ++columnGeneration.current;
    setColumnNames([]);
    setMetadataErrorMessage(null);
    if (table === null) return;

    void ipc.listColumns(FIXTURE_CONNECTION_ID, coreToTableRef(table)).then(
      (rows) => {
        if (!mounted.current || generation !== columnGeneration.current) return;
        setColumnNames(rows.map((column) => column.name));
      },
      () => {
        if (!mounted.current || generation !== columnGeneration.current) return;
        setColumnNames([]);
        setMetadataErrorMessage(VisualQueryCopy.columnsLoadError);
      },
    );
  }

  return (
    <main className="app-shell">
      <VisualQueryCanvas
        tables={tables}
        columnNames={columnNames}
        metadataErrorMessage={metadataErrorMessage}
        isConnected={true}
        onCommittedFromChange={handleCommittedFromChange}
      />
    </main>
  );
}
