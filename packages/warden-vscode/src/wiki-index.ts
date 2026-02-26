import { readdir, readFile } from "node:fs/promises";
import path from "node:path";

import type { WikiEntry } from "./types";

const CODE_PATTERN = /^WD-M\d-\d{3}$/;

function parseDescription(markdown: string, code: string): string {
  const firstLine = markdown.split(/\r?\n/, 1)[0] ?? "";
  const heading = firstLine.replace(/^#+\s*/, "").trim();
  if (!heading) {
    return code;
  }
  if (heading.toUpperCase().startsWith(code)) {
    const pieces = heading.split("--");
    return (pieces[1] ?? code).trim();
  }
  return heading;
}

export async function loadWikiEntries(
  workspaceRoot: string,
): Promise<WikiEntry[]> {
  const wikiDir = path.join(workspaceRoot, "wiki");
  try {
    const entries = await readdir(wikiDir, { withFileTypes: true });
    const files = entries
      .filter((entry) => entry.isFile() && entry.name.endsWith(".md"))
      .map((entry) => entry.name)
      .sort((a, b) => a.localeCompare(b));

    const result: WikiEntry[] = [];
    for (const file of files) {
      const code = file.replace(/\.md$/, "").toUpperCase();
      if (!CODE_PATTERN.test(code)) {
        continue;
      }
      const wikiPath = path.join("wiki", file);
      const absolute = path.join(workspaceRoot, wikiPath);
      const markdown = await readFile(absolute, "utf8").catch(() => "");
      result.push({
        code,
        description: parseDescription(markdown, code),
        wikiPath,
      });
    }
    return result;
  } catch {
    return [];
  }
}
