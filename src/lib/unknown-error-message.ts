/** Fallback when a query run rejects with a non-Error / empty message. */
export const QUERY_FAILED_MESSAGE = "Query failed";

/** Extract a human-readable message from an unknown thrown value. */
export function unknownErrorMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (error && typeof error === "object" && "message" in error) {
    const message = (error as { message: unknown }).message;
    if (typeof message === "string" && message.length > 0) return message;
  }
  return fallback;
}
