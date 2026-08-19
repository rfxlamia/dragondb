/** Display name for a table in the connection column (Swift `displayName` parity). */
export function tableDisplayName(table: { schema?: string | null; name: string }): string {
  if (table.schema && table.schema !== "public") {
    return `${table.schema}.${table.name}`;
  }
  return table.name;
}
