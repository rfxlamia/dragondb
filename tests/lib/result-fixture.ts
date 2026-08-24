import type { QueryResult, ResultCell, ResultColumn, ValueCell } from "../../src/ipc/contract";

type ResultFixtureOptions = Partial<QueryResult> & Pick<QueryResult, "columns">;

export function valueCell(value: string | number | boolean | bigint): ValueCell {
  return { state: "value", text: String(value) };
}

function defaultColumnType(name: string): ResultColumn {
  return { name, typeName: "text", typeOid: 25 };
}

export function resultFixture(options: ResultFixtureOptions): QueryResult {
  const columns = [...options.columns];
  return {
    columns,
    columnTypes: options.columnTypes ?? columns.map(defaultColumnType),
    rows: options.rows ?? ([] as ResultCell[][]),
    rowsAffected: options.rowsAffected ?? null,
    statementCount: options.statementCount ?? 1,
    durationMs: options.durationMs ?? 0,
  };
}
