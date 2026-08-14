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
const QUALIFIED_IDENT = '(?:"[^"]+"|[A-Za-z_][\\w$]*)(?:\\.(?:"[^"]+"|[A-Za-z_][\\w$]*))*';

export function extractTableName(sql: string): ExtractedTable | null {
  const trimmed = sql.trim();
  const kind = detectQueryType(sql);
  let match: RegExpMatchArray | null = null;

  switch (kind) {
    case "select":
      match = trimmed.match(new RegExp(`\\bFROM\\s+(${QUALIFIED_IDENT})`, "i"));
      break;
    case "insert":
      match = trimmed.match(new RegExp(`INSERT\\s+INTO\\s+(${QUALIFIED_IDENT})`, "i"));
      break;
    case "update":
      match = trimmed.match(new RegExp(`UPDATE\\s+(${QUALIFIED_IDENT})`, "i"));
      break;
    case "delete":
      match = trimmed.match(new RegExp(`DELETE\\s+FROM\\s+(${QUALIFIED_IDENT})`, "i"));
      break;
    case "createTable":
      match = trimmed.match(
        new RegExp(
          `CREATE\\s+(?:TEMP(?:ORARY)?\\s+)?TABLE\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?(${QUALIFIED_IDENT})`,
          "i",
        ),
      );
      break;
    case "dropTable":
      match = trimmed.match(
        new RegExp(`DROP\\s+TABLE\\s+(?:IF\\s+EXISTS\\s+)?(${QUALIFIED_IDENT})`, "i"),
      );
      break;
    case "alterTable":
      match = trimmed.match(new RegExp(`ALTER\\s+TABLE\\s+(${QUALIFIED_IDENT})`, "i"));
      break;
    default:
      return null;
  }

  return match?.[1] ? splitQualifiedName(match[1]) : null;
}

function splitQualifiedName(raw: string): ExtractedTable {
  const parts: string[] = [];
  let i = 0;
  while (i < raw.length) {
    if (raw.charAt(i) === ".") {
      i += 1;
      continue;
    }
    if (raw.charAt(i) === '"') {
      const end = raw.indexOf('"', i + 1);
      if (end === -1) {
        parts.push(raw.slice(i + 1));
        break;
      }
      parts.push(raw.slice(i + 1, end));
      i = end + 1;
      continue;
    }
    let j = i;
    while (j < raw.length && /[A-Za-z0-9_$]/.test(raw.charAt(j))) {
      j += 1;
    }
    if (j === i) {
      break;
    }
    parts.push(raw.slice(i, j));
    i = j;
  }
  const name = parts.pop() ?? "";
  return {
    schema: parts.length > 0 ? parts.join(".") : undefined,
    name,
  };
}
