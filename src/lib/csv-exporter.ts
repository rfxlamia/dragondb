/**
 * Swift CSVExporter.toCSV parity: quote only when comma/newline/CR/quote present;
 * empty string and null/undefined become bare empty fields (not `""`).
 */
export function toCsv(
  columns: string[],
  rows: ReadonlyArray<ReadonlyArray<string | null | undefined>>,
): string {
  if (columns.length === 0) {
    return "";
  }

  const lines: string[] = [];
  lines.push(columns.map(escapeCsvField).join(","));

  for (const row of rows) {
    const values = columns.map((_, index) => {
      const cell = row[index];
      if (cell === null || cell === undefined) {
        return "";
      }
      return escapeCsvField(cell);
    });
    lines.push(values.join(","));
  }

  return lines.join("\n");
}

function escapeCsvField(field: string): string {
  const needsQuoting =
    field.includes(",") || field.includes("\n") || field.includes("\r") || field.includes('"');

  if (!needsQuoting) {
    return field;
  }

  return `"${field.replaceAll('"', '""')}"`;
}
