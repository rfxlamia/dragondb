export type ColumnPresentationCategory =
  | "date"
  | "timestamp"
  | "timestamptz"
  | "number"
  | "boolean"
  | "text";

export interface ColumnTypeCategory {
  category: ColumnPresentationCategory;
  exactPrecision: boolean;
}

const TEXT_CATEGORY: ColumnTypeCategory = {
  category: "text",
  exactPrecision: false,
};

export function categorizeColumnType(typeOid: number): ColumnTypeCategory {
  switch (typeOid) {
    case 1082:
      return { category: "date", exactPrecision: false };
    case 1114:
      return { category: "timestamp", exactPrecision: false };
    case 1184:
      return { category: "timestamptz", exactPrecision: false };
    case 16:
      return { category: "boolean", exactPrecision: false };
    case 20:
    case 1700:
      return { category: "number", exactPrecision: true };
    case 21:
    case 23:
    case 700:
    case 701:
      return { category: "number", exactPrecision: false };
    default:
      return TEXT_CATEGORY;
  }
}
