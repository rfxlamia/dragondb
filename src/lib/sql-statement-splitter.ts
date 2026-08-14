/**
 * Split SQL into statements. Semicolons inside quotes, dollar-quotes, and
 * comments are not terminators. Statements are returned trimmed without the
 * terminating semicolon; leading inter-statement trivia (whitespace/comments)
 * is stripped so comment-only gaps between statements disappear.
 */
export function splitSqlStatements(sql: string): string[] {
  const statements: string[] = [];
  let current = "";
  let i = 0;

  const pushCurrent = () => {
    const cleaned = stripLeadingTrivia(current).trim();
    if (cleaned.length > 0) {
      statements.push(cleaned);
    }
    current = "";
  };

  while (i < sql.length) {
    const char = sql.charAt(i);

    // Dollar-quoted string: $$...$$ or $tag$...$tag$
    if (char === "$") {
      const tagEnd = scanDollarTag(sql, i);
      if (tagEnd !== null) {
        const tag = sql.slice(i, tagEnd + 1);
        current += tag;
        i = tagEnd + 1;
        while (i < sql.length) {
          if (sql.charAt(i) === "$") {
            const closeEnd = scanDollarTag(sql, i);
            if (closeEnd !== null && sql.slice(i, closeEnd + 1) === tag) {
              current += tag;
              i = closeEnd + 1;
              break;
            }
          }
          current += sql.charAt(i);
          i += 1;
        }
        continue;
      }
    }

    // Quoted string or identifier ('' / "" escapes)
    if (char === "'" || char === '"') {
      const quoted = consumeQuoted(sql, i, char);
      current += quoted.text;
      i = quoted.end;
      continue;
    }

    // Line comment --
    if (char === "-" && sql.charAt(i + 1) === "-") {
      current += "--";
      i += 2;
      while (i < sql.length && sql.charAt(i) !== "\n") {
        current += sql.charAt(i);
        i += 1;
      }
      continue;
    }

    // Nested block comment /* */
    if (char === "/" && sql.charAt(i + 1) === "*") {
      const comment = consumeBlockComment(sql, i);
      current += comment.text;
      i = comment.end;
      continue;
    }

    if (char === ";") {
      pushCurrent();
      i += 1;
      continue;
    }

    current += char;
    i += 1;
  }

  pushCurrent();
  return statements;
}

function consumeQuoted(
  sql: string,
  start: number,
  quote: "'" | '"',
): { text: string; end: number } {
  let text = quote;
  let i = start + 1;
  while (i < sql.length) {
    const q = sql.charAt(i);
    text += q;
    if (q === quote) {
      if (sql.charAt(i + 1) === quote) {
        text += quote;
        i += 2;
      } else {
        i += 1;
        break;
      }
    } else {
      i += 1;
    }
  }
  return { text, end: i };
}

function consumeBlockComment(sql: string, start: number): { text: string; end: number } {
  let text = "/*";
  let i = start + 2;
  let depth = 1;
  while (i < sql.length && depth > 0) {
    if (sql.charAt(i) === "/" && sql.charAt(i + 1) === "*") {
      text += "/*";
      depth += 1;
      i += 2;
      continue;
    }
    if (sql.charAt(i) === "*" && sql.charAt(i + 1) === "/") {
      text += "*/";
      depth -= 1;
      i += 2;
      continue;
    }
    text += sql.charAt(i);
    i += 1;
  }
  return { text, end: i };
}

function scanDollarTag(sql: string, start: number): number | null {
  // start points at '$'
  let j = start + 1;
  while (j < sql.length) {
    const c = sql.charAt(j);
    if (/[A-Za-z0-9_]/.test(c)) {
      j += 1;
      continue;
    }
    break;
  }
  if (j < sql.length && sql.charAt(j) === "$") {
    return j;
  }
  return null;
}

function stripLeadingTrivia(input: string): string {
  let i = 0;
  while (i < input.length) {
    const c = input.charAt(i);
    if (c === " " || c === "\t" || c === "\r" || c === "\n") {
      i += 1;
      continue;
    }
    if (c === "-" && input.charAt(i + 1) === "-") {
      i += 2;
      while (i < input.length && input.charAt(i) !== "\n") {
        i += 1;
      }
      continue;
    }
    if (c === "/" && input.charAt(i + 1) === "*") {
      i = consumeBlockComment(input, i).end;
      continue;
    }
    break;
  }
  return input.slice(i);
}
