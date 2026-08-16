/** English chrome copy for the workspace tab bar. */
export const TabBarCopy = {
  newTab: "New Tab",
  closeTab: "Close tab",
  untitled: "Untitled",
  closing: "Closing...",
} as const;

export function formatTabTitle(input: {
  databaseName?: string | null;
  savedQueryName?: string | null;
  connectionDisplayName?: string | null;
  index: number;
}): string {
  const { databaseName, savedQueryName, connectionDisplayName, index } = input;
  if (databaseName && savedQueryName) {
    return `${databaseName} / ${savedQueryName}`;
  }
  if (connectionDisplayName && databaseName) {
    return `${connectionDisplayName} / ${databaseName}`;
  }
  return `New Tab ${index}`;
}
