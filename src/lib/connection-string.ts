export type ConnectionStringParseErrorCode =
  | "invalidFormat"
  | "invalidScheme"
  | "invalidPort"
  | "emptyHost"
  | "malformedURL"
  | "invalidPercentEncoding";

export class ConnectionStringParseError extends Error {
  readonly code: ConnectionStringParseErrorCode;

  constructor(code: ConnectionStringParseErrorCode, message?: string) {
    super(message ?? code);
    this.name = "ConnectionStringParseError";
    this.code = code;
  }
}

export type ParsedConnectionString = {
  scheme: string;
  host: string;
  port: number;
  user?: string;
  password?: string;
  database?: string;
  sslmode?: string;
  queryParameters: Record<string, string>;
};

const DEFAULT_PORT = 5432;
const SCHEME_RE = /^(postgres|postgresql):\/\//i;

function decodeComponent(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (error) {
    if (error instanceof URIError) {
      throw new ConnectionStringParseError(
        "invalidPercentEncoding",
        "Invalid percent-encoding in connection string",
      );
    }
    throw error;
  }
}

function lookLikeInvalidPort(input: string): boolean {
  // Authority port that is present but non-numeric → invalidPort taxonomy.
  const match = input.match(/^postgres(?:ql)?:\/\/(?:[^@/?#]*@)?[^:/?#]*:([^@/?#]*)/i);
  if (!match) return false;
  const port = match[1] ?? "";
  return port.length > 0 && !/^\d+$/.test(port);
}

export function parseConnectionString(connectionString: string): ParsedConnectionString {
  const trimmed = connectionString.trim();
  if (!trimmed) {
    throw new ConnectionStringParseError("invalidFormat", "Invalid connection string format");
  }

  const schemeMatch = trimmed.match(SCHEME_RE);
  if (!schemeMatch) {
    // Wrong scheme (e.g. mysql://) vs completely malformed.
    if (/^[a-zA-Z][a-zA-Z0-9+.-]*:\/\//.test(trimmed)) {
      throw new ConnectionStringParseError(
        "invalidScheme",
        "Invalid scheme. Use 'postgres://' or 'postgresql://'",
      );
    }
    throw new ConnectionStringParseError("malformedURL", "Malformed connection string URL");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    if (lookLikeInvalidPort(trimmed)) {
      throw new ConnectionStringParseError(
        "invalidPort",
        "Invalid port number in connection string",
      );
    }
    throw new ConnectionStringParseError("malformedURL", "Malformed connection string URL");
  }

  const scheme = url.protocol.replace(/:$/, "").toLowerCase();
  if (scheme !== "postgres" && scheme !== "postgresql") {
    throw new ConnectionStringParseError(
      "invalidScheme",
      "Invalid scheme. Use 'postgres://' or 'postgresql://'",
    );
  }

  const host = url.hostname;
  if (!host) {
    throw new ConnectionStringParseError("emptyHost", "Host cannot be empty in connection string");
  }

  let port = DEFAULT_PORT;
  if (url.port) {
    const portValue = Number(url.port);
    if (!Number.isInteger(portValue) || portValue < 1 || portValue > 65535) {
      throw new ConnectionStringParseError(
        "invalidPort",
        "Invalid port number in connection string",
      );
    }
    port = portValue;
  }

  const databasePath = url.pathname.replace(/^\/+/, "");
  const database = databasePath.length > 0 ? decodeComponent(databasePath) : undefined;

  const queryParameters: Record<string, string> = {};
  url.searchParams.forEach((value, key) => {
    queryParameters[key] = value;
  });

  const sslmode = queryParameters.sslmode;

  return {
    scheme,
    host,
    port,
    user: url.username ? decodeComponent(url.username) : undefined,
    password: url.password ? decodeComponent(url.password) : undefined,
    database,
    sslmode: sslmode !== undefined ? sslmode : undefined,
    queryParameters,
  };
}

export function buildConnectionString(parsed: ParsedConnectionString): string {
  const scheme = "postgresql";
  const user = parsed.user;
  const password = parsed.password;

  let auth = "";
  if (user) {
    auth = encodeURIComponent(user);
    if (password) {
      auth += `:${encodeURIComponent(password)}`;
    }
    auth += "@";
  }

  const portPart = parsed.port !== DEFAULT_PORT ? `:${parsed.port}` : "";
  const dbPart = parsed.database ? `/${encodeURIComponent(parsed.database)}` : "";

  const params = new URLSearchParams();
  if (parsed.sslmode) {
    params.set("sslmode", parsed.sslmode);
  }
  const query = params.toString();
  const queryPart = query ? `?${query}` : "";

  return `${scheme}://${auth}${parsed.host}${portPart}${dbPart}${queryPart}`;
}
