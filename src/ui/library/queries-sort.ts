import type { SavedQueryDto } from "../../ipc/contract";

export type QuerySortKey =
  | "name-asc"
  | "name-desc"
  | "created-desc"
  | "created-asc"
  | "updated-desc"
  | "updated-asc";

export function sortQueries(queries: SavedQueryDto[], sort: QuerySortKey): SavedQueryDto[] {
  return [...queries].sort((a, b) => {
    switch (sort) {
      case "name-asc":
        return a.name.localeCompare(b.name);
      case "name-desc":
        return b.name.localeCompare(a.name);
      case "created-desc":
        return b.createdAt.localeCompare(a.createdAt);
      case "created-asc":
        return a.createdAt.localeCompare(b.createdAt);
      case "updated-desc":
        return b.updatedAt.localeCompare(a.updatedAt);
      case "updated-asc":
        return a.updatedAt.localeCompare(b.updatedAt);
      default:
        return 0;
    }
  });
}
