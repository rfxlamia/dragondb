import type { QueryResult, ResultCell, ResultColumn, ValueCell } from "../../src/ipc/contract";

type FixtureValue = ResultCell | string | number | boolean | bigint;

type ResultFixtureOptions = Omit<Partial<QueryResult>, "rows"> &
  Pick<QueryResult, "columns"> & {
    rows?: FixtureValue[][];
  };

export function valueCell(value: string | number | boolean | bigint): ValueCell {
  return { state: "value", text: String(value) };
}

export function resultRows(rows: FixtureValue[][]): ResultCell[][] {
  return rows.map((row) =>
    row.map((cell) =>
      cell == null || (typeof cell === "object" && "state" in cell) ? cell : valueCell(cell),
    ),
  );
}

function defaultColumnType(name: string): ResultColumn {
  return { name, typeName: "text", typeOid: 25 };
}

export function resultFixture(options: ResultFixtureOptions): QueryResult {
  const columns = [...options.columns];
  return {
    columns,
    columnTypes: options.columnTypes ?? columns.map(defaultColumnType),
    rows: options.rows == null ? [] : resultRows(options.rows),
    rowsAffected: options.rowsAffected ?? null,
    statementCount: options.statementCount ?? 1,
    durationMs: options.durationMs ?? 0,
  };
}
