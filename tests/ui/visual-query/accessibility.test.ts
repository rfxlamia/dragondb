import { describe, expect, it } from "vitest";
import { VisualQueryAccessibility } from "../../../src/ui/visual-query/accessibility";

const EXPECTED_STATICS = [
  "visualQuery.modeToggle",
  "visualQuery.initialAddBlock",
  "visualQuery.trailingAddBlock",
  "visualQuery.statementMenu",
  "visualQuery.clauseMenu",
  "visualQuery.startOver",
  "visualQuery.runQuery",
  "visualQuery.viewGeneratedSQL",
  "visualQuery.generatedSQLText",
  "visualQuery.copySQL",
  "visualQuery.generatedSQLDone",
  "visualQuery.allColumnsToggle",
  "visualQuery.selectColumnsField",
  "visualQuery.selectColumnsPicker",
  "visualQuery.fromTableField",
  "visualQuery.fromTablePicker",
  "visualQuery.whereColumnField",
  "visualQuery.whereColumnPicker",
  "visualQuery.whereOperatorField",
  "visualQuery.whereValueField",
  "visualQuery.orderByColumnField",
  "visualQuery.orderByColumnPicker",
  "visualQuery.orderByDirectionField",
  "visualQuery.limitField",
  "visualQuery.createTableNameField",
  "visualQuery.createColumnsList",
  "visualQuery.addCreateColumn",
  "visualQuery.schemaPopoverSearch",
  "visualQuery.schemaPopoverList",
  "visualQuery.confirmCreateContinue",
  "visualQuery.confirmCreateCancel",
] as const;

describe("VisualQueryAccessibility", () => {
  it("static identifiers match Swift VisualQueryAccessibility", () => {
    for (const id of EXPECTED_STATICS) {
      expect(VisualQueryAccessibility.allInteractiveIdentifiers).toContain(id);
    }
    expect(VisualQueryAccessibility.modeToggle).toBe("visualQuery.modeToggle");
    expect(VisualQueryAccessibility.clauseCard("orderBy")).toBe("visualQuery.clauseCard.orderBy");
    expect(VisualQueryAccessibility.statementMenuItem("createTable")).toBe(
      "visualQuery.statementMenu.createTable",
    );
  });

  it("interactive identifiers are unique", () => {
    const ids = VisualQueryAccessibility.allInteractiveIdentifiers;
    expect(new Set(ids).size).toBe(ids.length);
  });
});
