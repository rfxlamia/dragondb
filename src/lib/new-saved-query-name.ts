/** Swift SavedQueriesViewModel `Query yy-MM-dd H:mm:ss` (hour zero-padded). */
export function newSavedQueryName(date: Date): string {
  const yy = String(date.getFullYear()).slice(-2);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hour = String(date.getHours()).padStart(2, "0");
  const minute = String(date.getMinutes()).padStart(2, "0");
  const second = String(date.getSeconds()).padStart(2, "0");
  return `Query ${yy}-${month}-${day} ${hour}:${minute}:${second}`;
}
