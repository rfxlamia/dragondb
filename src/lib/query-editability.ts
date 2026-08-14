import { detectQueryType } from "./query-type-detector";

export type EditabilityReason = {
  title: string;
  body: string;
};

export type EditabilityResult = {
  isEditable: boolean;
  tableName?: string;
  schema?: string;
  reason?: EditabilityReason;
};

export type EditabilityContext = {
  sourceTable?: { schema?: string; name: string };
};

/**
 * Swift QueryEditability.determineQueryEditability port.
 * Reason titles must match Swift exactly.
 */
export function determineEditability(
  query: string,
  context: EditabilityContext,
): EditabilityResult {
  if (context.sourceTable) {
    return {
      isEditable: true,
      tableName: context.sourceTable.name,
      schema: context.sourceTable.schema,
    };
  }

  return analyzeQueryForEditability(query);
}

function analyzeQueryForEditability(query: string): EditabilityResult {
  const normalized = query.toUpperCase();
  const reason = detectNonEditablePattern(normalized);
  if (reason) {
    return { isEditable: false, reason };
  }

  if (detectQueryType(query) !== "select") {
    return {
      isEditable: false,
      reason: {
        title: "Can't Edit Query Results",
        body: "Row editing is only available when viewing a table directly. Select a table from the sidebar to edit its rows.",
      },
    };
  }

  const extracted = extractTableFromSelect(query);
  if (extracted) {
    return {
      isEditable: true,
      tableName: extracted.table,
      schema: extracted.schema,
    };
  }

  return {
    isEditable: false,
    reason: {
      title: "Can't Edit Query Results",
      body: "Row editing is only available when viewing a table directly. Select a table from the sidebar to edit its rows.",
    },
  };
}

function detectNonEditablePattern(normalizedQuery: string): EditabilityReason | null {
  const trimmed = normalizedQuery.trim();
  if (trimmed.startsWith("WITH ")) {
    return {
      title: "Can't Edit CTE Results",
      body: "This query uses a Common Table Expression (WITH clause). To edit rows, select a table from the sidebar.",
    };
  }

  const joinPatterns = [
    " JOIN ",
    " INNER JOIN ",
    " LEFT JOIN ",
    " RIGHT JOIN ",
    " FULL JOIN ",
    " CROSS JOIN ",
  ];
  for (const pattern of joinPatterns) {
    if (normalizedQuery.includes(pattern)) {
      return {
        title: "Can't Edit Joined Results",
        body: "This query combines data from multiple tables. To edit rows, select a single table from the sidebar.",
      };
    }
  }

  if (
    normalizedQuery.includes(" UNION ") ||
    normalizedQuery.includes(" INTERSECT ") ||
    normalizedQuery.includes(" EXCEPT ")
  ) {
    return {
      title: "Can't Edit Combined Results",
      body: "This query combines multiple result sets. To edit rows, select a single table from the sidebar.",
    };
  }

  if (normalizedQuery.includes(" GROUP BY ")) {
    return {
      title: "Can't Edit Grouped Data",
      body: "This query shows grouped/summarized data, not individual rows. To edit rows, select the table from the sidebar.",
    };
  }

  if (
    normalizedQuery.includes("SELECT DISTINCT ") ||
    normalizedQuery.includes("SELECT  DISTINCT ")
  ) {
    return {
      title: "Can't Edit Distinct Results",
      body: "This query returns unique values only. To edit rows, select the table from the sidebar.",
    };
  }

  if (normalizedQuery.includes(" OVER(") || normalizedQuery.includes(" OVER (")) {
    return {
      title: "Can't Edit Window Function Results",
      body: "This query includes window functions. To edit rows, select the table from the sidebar.",
    };
  }

  const aggregates = [
    "COUNT(",
    "SUM(",
    "AVG(",
    "MIN(",
    "MAX(",
    "ARRAY_AGG(",
    "STRING_AGG(",
    "JSON_AGG(",
    "JSONB_AGG(",
  ];
  for (const agg of aggregates) {
    if (normalizedQuery.includes(agg)) {
      return {
        title: "Can't Edit Aggregated Data",
        body: "This query shows summarized data, not individual rows. To edit rows, select the table from the sidebar.",
      };
    }
  }

  if (hasMultipleTablesInFrom(normalizedQuery)) {
    return {
      title: "Can't Edit Multi-Table Results",
      body: "This query references multiple tables. To edit rows, select a single table from the sidebar.",
    };
  }

  return null;
}

function hasMultipleTablesInFrom(normalizedQuery: string): boolean {
  const fromIndex = normalizedQuery.indexOf("FROM ");
  if (fromIndex === -1) {
    return false;
  }

  const afterFrom = normalizedQuery.slice(fromIndex + "FROM ".length);
  const terminators = [" WHERE ", " ORDER ", " LIMIT ", " GROUP ", " HAVING ", " OFFSET ", ";"];
  let fromClause = afterFrom;
  for (const terminator of terminators) {
    const termIndex = afterFrom.indexOf(terminator);
    if (termIndex !== -1 && termIndex < fromClause.length) {
      fromClause = afterFrom.slice(0, termIndex);
    }
  }

  let depth = 0;
  for (const char of fromClause) {
    if (char === "(") {
      depth += 1;
    } else if (char === ")") {
      depth -= 1;
    } else if (char === "," && depth === 0) {
      return true;
    }
  }

  return false;
}

function extractTableFromSelect(
  query: string,
): { table: string; schema: string | undefined } | null {
  const trimmed = query.trim();
  // FROM [schema.]table — quoted or unquoted identifiers
  const pattern = /\bFROM\s+(?:(?:"([^"]+)"|(\w+))\.)?(?:"([^"]+)"|(\w+))/i;
  const match = trimmed.match(pattern);
  if (!match) {
    return null;
  }

  const schema = match[1] || match[2] || undefined;
  const table = match[3] || match[4];
  if (!table) {
    return null;
  }

  return { table, schema };
}
