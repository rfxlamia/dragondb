import type { SslMode } from "../../ipc/contract";
import type { ParsedConnectionString } from "../../lib/connection-string";
import { profileConnectionStringForCopy } from "../../lib/profile-connection-string";
import type { ConnectionFormProfileFields } from "./connection-form";

const SSL_MODES: readonly SslMode[] = [
  "disable",
  "allow",
  "prefer",
  "require",
  "verify-ca",
  "verify-full",
];

function isSslMode(value: string | undefined): value is SslMode {
  return value !== undefined && (SSL_MODES as readonly string[]).includes(value);
}

export function profileFromParsedUri(
  profile: ConnectionFormProfileFields,
  parsed: ParsedConnectionString,
): ConnectionFormProfileFields {
  return {
    ...profile,
    host: parsed.host,
    port: parsed.port,
    username: parsed.user ?? "",
    database: parsed.database ?? "",
    sslMode: isSslMode(parsed.sslmode) ? parsed.sslmode : profile.sslMode,
  };
}

export function copyUriForProfile(profile: ConnectionFormProfileFields): string {
  return profileConnectionStringForCopy({
    host: profile.host,
    port: profile.port,
    username: profile.username,
    database: profile.database,
  });
}
