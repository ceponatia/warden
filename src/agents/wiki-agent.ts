import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import { lookupCode } from "../findings/registry.js";
import { callProvider } from "./provider.js";

function defaultWikiTemplate(code: string, title: string): string {
  return `# ${code} -- ${title}

## What this means

TBD.

## Common causes

- TBD

## Resolution patterns

### Pattern: TBD
TBD

## Examples from this codebase

- TBD

---
Last updated: ${new Date().toISOString()}
Updated by: manual
`;
}

function buildPrompt(
  code: string,
  title: string,
  currentContent: string,
  resolutionContext: string,
): string {
  return `You are updating a Warden finding wiki page.

Finding code: ${code}
Title: ${title}

Current wiki page:
---
${currentContent}
---

Resolution context:
---
${resolutionContext}
---

Update the page by improving only:
- "Resolution patterns"
- "Examples from this codebase"
- footer timestamp and updater

Return full markdown only.`;
}

export async function updateWikiPageForResolvedFinding(
  code: string,
  resolutionContext: string,
): Promise<void> {
  const definition = lookupCode(code);
  if (!definition) {
    return;
  }

  const wikiPath = path.resolve(process.cwd(), definition.wikiPath);
  await mkdir(path.dirname(wikiPath), { recursive: true });

  let currentContent: string;
  try {
    currentContent = await readFile(wikiPath, "utf8");
  } catch {
    currentContent = defaultWikiTemplate(code, definition.shortDescription);
  }

  const updatedMarkdown = await callProvider({
    systemPrompt:
      "You maintain concise engineering wiki pages. Preserve markdown structure and avoid adding unrelated sections.",
    userPrompt: buildPrompt(
      code,
      definition.shortDescription,
      currentContent,
      resolutionContext,
    ),
  });

  await writeFile(wikiPath, `${updatedMarkdown.trim()}\n`, "utf8");
}
