interface RenderPageOptions {
  slug?: string;
  bodyAttrs?: Record<string, string>;
  scripts?: string[];
}

function nav(slug?: string): string {
  const repoLinks = slug
    ? `<a href="/repo/${encodeURIComponent(slug)}">Repo</a>
       <a href="/repo/${encodeURIComponent(slug)}/trends">Trends</a>
       <a href="/repo/${encodeURIComponent(slug)}/work">Work</a>
       <a href="/repo/${encodeURIComponent(slug)}/agents">Agents</a>`
    : "";

  return `<nav>
    <a href="/">Overview</a>
    ${repoLinks}
    <a href="/wiki">Wiki</a>
  </nav>`;
}

function renderBodyAttrs(attrs: Record<string, string> | undefined): string {
  if (!attrs) {
    return "";
  }
  return Object.entries(attrs)
    .map(([key, value]) => `${key}="${escapeHtml(value)}"`)
    .join(" ");
}

export function renderPage(
  title: string,
  body: string,
  options: RenderPageOptions = {},
): string {
  const safeTitle = escapeHtml(title);
  const bodyAttrs = renderBodyAttrs(options.bodyAttrs);
  const scripts = options.scripts ?? [];
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="/static/style.css" />
  </head>
  <body ${bodyAttrs}>
    <main>
      <h1>${safeTitle}</h1>
      ${nav(options.slug)}
      ${body}
    </main>
    ${scripts.map((src) => `<script src="${escapeHtml(src)}"></script>`).join("\n")}
  </body>
</html>`;
}

export function severityBadge(severity: string): string {
  return `<span class="badge badge-${severity.toLowerCase()}">${severity}</span>`;
}

export function escapeHtml(input: string): string {
  return input
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
