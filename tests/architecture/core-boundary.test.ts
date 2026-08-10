import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const CORE_DIR = join(process.cwd(), "src", "core");

/**
 * Regression backup for the two primary guards: tsconfig.core.json (no DOM lib)
 * and Biome's noRestrictedImports. Patterns cover static, side-effect, and
 * dynamic imports, with or without a trailing slash.
 */
const FORBIDDEN_SPECIFIER = /^(@tauri-apps(\/|$)|.*\/(ui|stores|ipc)(\/|$))/;

const IMPORT_PATTERNS = [
  /\bfrom\s*['"]([^'"]+)['"]/g, // import x from '…'  /  export … from '…'
  /\bimport\s*['"]([^'"]+)['"]/g, // import '…'  (side effect)
  /\bimport\s*\(\s*['"]([^'"]+)['"]/g, // import('…')  (dynamic)
  /\brequire\s*\(\s*['"]([^'"]+)['"]/g,
];

const FORBIDDEN_GLOBALS =
  /\b(document|window|localStorage|sessionStorage|navigator|fetch|XMLHttpRequest)\b\s*[.[(]/;

function collectTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...collectTsFiles(full));
    else if (entry.endsWith(".ts")) out.push(full);
  }
  return out;
}

describe("src/core boundary", () => {
  it("imports nothing from ui, stores, ipc, or Tauri", () => {
    const violations: string[] = [];

    for (const file of collectTsFiles(CORE_DIR)) {
      const source = readFileSync(file, "utf8");
      for (const pattern of IMPORT_PATTERNS) {
        for (const match of source.matchAll(pattern)) {
          const specifier = match[1];
          if (specifier !== undefined && FORBIDDEN_SPECIFIER.test(specifier)) {
            violations.push(`${file}: imports '${specifier}'`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it("touches no browser global", () => {
    const violations: string[] = [];

    for (const file of collectTsFiles(CORE_DIR)) {
      readFileSync(file, "utf8")
        .split("\n")
        .forEach((line, index) => {
          if (FORBIDDEN_GLOBALS.test(line)) {
            violations.push(`${file}:${index + 1}  ${line.trim()}`);
          }
        });
    }

    expect(violations).toEqual([]);
  });
});
