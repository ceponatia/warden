import * as vscode from "vscode";

import type { WikiEntry } from "./types";

const FINDING_CODE = /WD-M\d-\d{3}/g;

function inRange(index: number, start: number, end: number): boolean {
  return index >= start && index <= end;
}

function findCodeAtPosition(line: string, position: number): string | null {
  for (const match of line.matchAll(FINDING_CODE)) {
    const value = match[0];
    const start = match.index ?? -1;
    const end = start + value.length;
    if (inRange(position, start, end)) {
      return value.toUpperCase();
    }
  }
  return null;
}

export function createWikiHoverProvider(
  wikiByCode: Map<string, WikiEntry>,
): vscode.HoverProvider {
  return {
    provideHover(document, position) {
      const line = document.lineAt(position.line).text;
      const code = findCodeAtPosition(line, position.character);
      if (!code) {
        return null;
      }

      const entry = wikiByCode.get(code);
      if (!entry) {
        return null;
      }

      const markdown = new vscode.MarkdownString();
      markdown.appendMarkdown(`**${entry.code}** — ${entry.description}\n\n`);
      markdown.appendMarkdown(
        `[Open wiki page](command:warden.openWiki?${encodeURIComponent(JSON.stringify([entry.code]))})`,
      );
      markdown.isTrusted = true;
      return new vscode.Hover(markdown);
    },
  };
}
