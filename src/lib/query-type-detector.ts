export type SqlQueryType =
  | "select"
  | "insert"
  | "update"
  | "delete"
  | "createTable"
  | "dropTable"
  | "alterTable"
  | "other";

export type ExtractedTable = {
  schema: string | undefined;
  name: string;
};

const MUTATION_TYPES: ReadonlySet<SqlQueryType> = new Set([
  "insert",
  "update",
  "delete",
  "createTable",
  "dropTable",
  "alterTable",
]);

export function detectQueryType(sql: string): SqlQueryType {
  const trimmed = sql.trim().toUpperCase();

  if (trimmed.startsWith("SELECT") || trimmed.startsWith("WITH")) {
    return "select";
  }
  if (trimmed.startsWith("INSERT")) {
    return "insert";
  }
  if (trimmed.startsWith("UPDATE")) {
    return "update";
  }
  if (trimmed.startsWith("DELETE")) {
    return "delete";
  }
  if (/^CREATE\s+(TEMP(ORARY)?\s+)?TABLE/.test(trimmed)) {
    return "createTable";
  }
  if (/^DROP\s+TABLE/.test(trimmed)) {
    return "dropTable";
  }
  if (/^ALTER\s+TABLE/.test(trimmed)) {
    return "alterTable";
  }
  return "other";
}

export function isMutation(sql: string): boolean {
  return MUTATION_TYPES.has(detectQueryType(sql));
}

/**
 * Extract schema/name from common DML/DDL forms.
 * Unlike Swift's cleanTableName (table-only), this preserves schema when present
 * so callers can round-trip qualified names.
 */
export function extractTableName(sql: string): ExtractedTable | null {
  const trimmed = sql.trim();
  const tableNamePattern = '(?:"[^"]+"|[\\w.]+)';

  const fromMatch = trimmed.match(new RegExp(`\\bFROM\\s+(${tableNamePattern})`, "i"));
  if (fromMatch?.[1]) {
    return splitQualifiedName(fromMatch[1]);
  }

  const insertMatch = trimmed.match(new RegExp(`INSERT\\s+INTO\\s+(${tableNamePattern})`, "i"));
  if (insertMatch?.[1]) {
    return splitQualifiedName(insertMatch[1]);
  }

  const updateMatch = trimmed.match(new RegExp(`UPDATE\\s+(${tableNamePattern})`, "i"));
  if (updateMatch?.[1]) {
    return splitQualifiedName(updateMatch[1]);
  }

  const deleteMatch = trimmed.match(new RegExp(`DELETE\\s+FROM\\s+(${tableNamePattern})`, "i"));
  if (deleteMatch?.[1]) {
    return splitQualifiedName(deleteMatch[1]);
  }

  const createMatch = trimmed.match(
    new RegExp(
      `CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${tableNamePattern})`,
      "i",
    ),
  );
  if (createMatch?.[1]) {
    return splitQualifiedName(createMatch[1]);
  }

  const dropMatch = trimmed.match(
    new RegExp(`DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${tableNamePattern})`, "i"),
  );
  if (dropMatch?.[1]) {
    return splitQualifiedName(dropMatch[1]);
  }

  const alterMatch = trimmed.match(new RegExp(`ALTER\\s+TABLE\\s+(${tableNamePattern})`, "i"));
  if (alterMatch?.[1]) {
    return splitQualifiedName(alterMatch[1]);
  }

  return null;
}

function splitQualifiedName(raw: string): ExtractedTable {
  const cleaned = raw.replace(/"/g, "").replace(/'/g, "");
  const dot = cleaned.lastIndexOf(".");
  if (dot === -1) {
    return { schema: undefined, name: cleaned };
  }
  return {
    schema: cleaned.slice(0, dot) || undefined,
    name: cleaned.slice(dot + 1),
  };
}
