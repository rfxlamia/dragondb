import type { TableReference } from "../core";
import type { TableRef } from "./contract";

export function tableRefToCore(ref: TableRef): TableReference {
  return {
    schema: ref.schema ?? null,
    name: ref.name,
  };
}

export function coreToTableRef(ref: TableReference): TableRef {
  if (ref.schema === null) {
    return { name: ref.name };
  }
  return { schema: ref.schema, name: ref.name };
}

export function formatTableDisplayName(ref: TableReference): string {
  if (ref.schema === null || ref.schema === "public") {
    return ref.name;
  }
  return `${ref.schema}.${ref.name}`;
}

/** Raw FROM text that round-trips through parseTableReference without losing schema. */
export function formatTableCommitRaw(ref: TableReference): string {
  if (ref.schema === null) {
    return ref.name;
  }
  return `${ref.schema}.${ref.name}`;
}

export function sameTable(a: TableReference | null, b: TableReference | null): boolean {
  if (a === null || b === null) return a === b;
  return a.schema === b.schema && a.name === b.name;
}
