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

export function renderPage(title: string, body: string, slug?: string): string {
  const safeTitle = escapeHtml(title);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${safeTitle}</title>
    <link rel="stylesheet" href="/static/style.css" />
  </head>
  <body>
    <main>
      <h1>${safeTitle}</h1>
      ${nav(slug)}
      ${body}
    </main>
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
