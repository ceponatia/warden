import { readFile } from "node:fs/promises";
import path from "node:path";

import type { Express, Request, Response } from "express";
import { Marked } from "marked";
import sanitizeHtml from "sanitize-html";

import { listCodes, lookupCode } from "../findings/registry.js";
import { escapeHtml, renderPage } from "./views/render.js";

const wikiMarked = new Marked();

async function renderMarkdownSafe(src: string): Promise<string> {
  const raw = await wikiMarked.parse(src);
  return sanitizeHtml(raw, {
    allowedTags: sanitizeHtml.defaults.allowedTags.concat(["h1", "h2", "h3"]),
    allowedAttributes: { ...sanitizeHtml.defaults.allowedAttributes },
    allowedSchemes: ["http", "https", "mailto"],
  });
}

async function renderWikiIndex(search: string): Promise<string> {
  const codes = listCodes().filter(
    (code) =>
      code.code.toLowerCase().includes(search.toLowerCase()) ||
      code.shortDescription.toLowerCase().includes(search.toLowerCase()),
  );

  const rows = codes
    .map(
      (code) =>
        `<tr><td><a href="/wiki/${code.code}">${code.code}</a></td><td>${code.metric}</td><td>${escapeHtml(code.shortDescription)}</td></tr>`,
    )
    .join("");

  return renderPage(
    "Wiki",
    `<div class="card"><form class="inline"><input name="q" value="${escapeHtml(search)}" placeholder="search code or keyword"/><button type="submit">Search</button></form></div>
    <div class="table-wrap"><table><thead><tr><th>Code</th><th>Metric</th><th>Description</th></tr></thead><tbody>${rows}</tbody></table></div>`,
  );
}

async function renderWikiPage(code: string): Promise<string> {
  const definition = lookupCode(code.toUpperCase());
  if (!definition) {
    return renderPage(
      "Wiki",
      `<div class="card">Unknown code: ${escapeHtml(code)}</div>`,
    );
  }

  const wikiPath = path.resolve(process.cwd(), definition.wikiPath);
  const raw = await readFile(wikiPath, "utf8").catch(
    () => "Wiki page not found.",
  );
  const html = await renderMarkdownSafe(raw);

  return renderPage(
    `Wiki: ${definition.code}`,
    `<div class="card"><p>${escapeHtml(definition.shortDescription)}</p></div><div class="card">${html}</div>`,
  );
}

function paramValue(value: string | string[] | undefined): string {
  if (!value) return "";
  if (Array.isArray(value)) return value[0] ?? "";
  return value;
}

export function registerWikiRoutes(app: Express): void {
  app.get("/wiki", async (req: Request, res: Response) => {
    const search = typeof req.query.q === "string" ? req.query.q : "";
    res.type("html").send(await renderWikiIndex(search));
  });

  app.get("/wiki/:code", async (req: Request, res: Response) => {
    res.type("html").send(await renderWikiPage(paramValue(req.params.code)));
  });
}
