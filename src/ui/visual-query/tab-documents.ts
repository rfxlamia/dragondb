import { QueryDocument } from "../../core";

export type TabDocuments = {
  getOrCreate: (id: string) => QueryDocument;
  resetAll: (ids: string[]) => void;
  delete: (id: string) => void;
};

/** In-session QueryDocument map keyed by tab id. Not persisted. */
export function createTabDocuments(): TabDocuments {
  const documents = new Map<string, QueryDocument>();

  function getOrCreate(id: string): QueryDocument {
    const existing = documents.get(id);
    if (existing !== undefined) return existing;
    const created = new QueryDocument();
    documents.set(id, created);
    return created;
  }

  function resetAll(ids: string[]): void {
    documents.clear();
    for (const id of ids) {
      documents.set(id, new QueryDocument());
    }
  }

  function deleteEntry(id: string): void {
    documents.delete(id);
  }

  return {
    getOrCreate,
    resetAll,
    delete: deleteEntry,
  };
}
