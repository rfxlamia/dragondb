/** Swift Constants.tableBrowseMaxCellCharacters */
export const MAX_CELL_CHARACTERS = 2048;

/** Swift Constants.tableBrowseTruncationSuffix */
export const TRUNCATION_SUFFIX = "... [truncated]";

/**
 * Compact a single cell value to maxCellCharacters including the suffix budget
 * (Swift TableBrowseResultCompactor.compactValue).
 */
export function compactCell(
  value: string,
  maxCellCharacters: number = MAX_CELL_CHARACTERS,
  truncationSuffix: string = TRUNCATION_SUFFIX,
): string {
  if (maxCellCharacters <= 0) {
    return truncationSuffix;
  }
  if (value.length <= maxCellCharacters) {
    return value;
  }

  const suffixLength = truncationSuffix.length;
  if (maxCellCharacters <= suffixLength) {
    return truncationSuffix.slice(0, maxCellCharacters);
  }

  const prefixLength = maxCellCharacters - suffixLength;
  return value.slice(0, prefixLength) + truncationSuffix;
}
