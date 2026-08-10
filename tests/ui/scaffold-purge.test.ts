import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

const ROOT = process.cwd();

function walk(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = join(dir, e);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else out.push(full);
  }
  return out;
}

describe("scaffold purge", () => {
  it("removes greet demo strings from src and index.html", () => {
    const FORBIDDEN = [
      /Welcome to Tauri/,
      /greet-input/,
      /You've been greeted/,
      /Tauri \+ React \+ Typescript/,
    ];
    const hits: string[] = [];
    for (const file of [...walk(join(ROOT, "src")), join(ROOT, "index.html")]) {
      if (!/\.(tsx?|css|html)$/.test(file)) continue;
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(text)) hits.push(`${file} matches ${re}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it("index.html uses DragonDB title and non-scaffold favicon", () => {
    const html = readFileSync(join(ROOT, "index.html"), "utf8");
    expect(html).toMatch(/<title>DragonDB<\/title>/);
    expect(html).not.toMatch(/vite\.svg|tauri\.svg|react\.svg/);
    expect(html).toMatch(/rel="icon"[^>]+href="\/favicon\.svg"/);
  });

  it("deletes scaffold public/src logos", () => {
    expect(existsSync(join(ROOT, "public/vite.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "public/tauri.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "src/assets/react.svg"))).toBe(false);
    expect(existsSync(join(ROOT, "public/favicon.svg"))).toBe(true);
  });

  it("removes greet from Rust lib", () => {
    const rust = readFileSync(join(ROOT, "src-tauri/src/lib.rs"), "utf8");
    expect(rust).not.toMatch(/\bgreet\b/);
  });
});
