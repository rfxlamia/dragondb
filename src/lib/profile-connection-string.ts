import { buildConnectionString } from "./connection-string";

export function profileConnectionStringForCopy(fields: {
  host: string;
  port: number;
  username: string;
  database: string;
}): string {
  return buildConnectionString({
    scheme: "postgresql",
    host: fields.host,
    port: fields.port,
    user: fields.username,
    password: "YOUR_PASSWORD",
    database: fields.database,
    queryParameters: {},
  });
}
