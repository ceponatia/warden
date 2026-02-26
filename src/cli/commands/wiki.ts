import { readFile } from "node:fs/promises";
import path from "node:path";

import { lookupCode } from "../../findings/registry.js";

export async function runWikiCommand(code: string): Promise<void> {
  const normalizedCode = code.toUpperCase();
  const definition = lookupCode(normalizedCode);
  if (!definition) {
    throw new Error(`Unknown finding code: ${normalizedCode}`);
  }

  const wikiPath = path.resolve(process.cwd(), definition.wikiPath);
  const content = await readFile(wikiPath, "utf8");
  process.stdout.write(content);
  if (!content.endsWith("\n")) {
    process.stdout.write("\n");
  }
}
