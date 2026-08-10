import type { ClauseKind, StatementKind } from "./query-clause";
import type { QueryDocument } from "./query-document";

/**
 * Presentation contract consumed by the visual query canvas.
 * Derives visible cards, trailing + options, and visible execution status.
 */
export class CanvasPresentation {
  readonly #doc: QueryDocument;
  readonly #statusMessage: string | null;

  constructor(doc: QueryDocument, statusMessage: string | null = null) {
    this.#doc = doc;
    this.#statusMessage = statusMessage;
  }

  get visibleStatusMessage(): string | null {
    if (this.#statusMessage === null) return null;
    const trimmed = this.#statusMessage.trim();
    return trimmed.length === 0 ? null : trimmed;
  }

  /**
   * Clause cards currently on the canvas — mirrors the document exactly.
   * Pressing + never invents a full SELECT chain here.
   */
  get visibleClauseKinds(): ClauseKind[] {
    return [...this.#doc.clauseKinds];
  }

  /** Trailing + menu options: missing SELECT clauses only, never JOIN. */
  get trailingOptions(): ClauseKind[] {
    return this.#doc.availableNextClauses();
  }

  /** An empty canvas shows the initial + until a statement is chosen. */
  get showsInitialAddButton(): boolean {
    return this.#doc.statementKind === null;
  }

  /** True when a non-SELECT root (CREATE / UPDATE / DELETE) renders a root card. */
  get showsStatementRootCard(): boolean {
    const kind = this.#doc.statementKind;
    return kind === "createTable" || kind === "update" || kind === "delete";
  }

  get statementKind(): StatementKind | null {
    return this.#doc.statementKind;
  }

  get showsTrailingAddButton(): boolean {
    return this.#doc.statementKind === "select" && this.trailingOptions.length > 0;
  }
}
