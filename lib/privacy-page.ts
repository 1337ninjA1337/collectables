/**
 * Renders PRIVACY.md into the standalone static page served at `/privacy` on
 * GitHub Pages (App Store review requires a public privacy-policy URL).
 *
 * Deliberately dependency-free: a tiny line-based converter covering exactly
 * the markdown constructs PRIVACY.md uses — headings, paragraphs, blockquotes,
 * `-` lists, pipe tables, `**bold**`, `_italic_` lines, `code` spans,
 * `[text](url)` links and bare https:// autolinks. Everything is HTML-escaped
 * first, so policy text can never inject markup. The page carries its own
 * strict CSP (no scripts, inline style only) and shares the app's palette.
 */

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
};

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"]/g, (ch) => HTML_ESCAPES[ch]);
}

/** Inline markdown on already-escaped text: code, bold, links, autolinks. */
export function renderInline(escaped: string): string {
  let out = escaped;
  out = out.replace(/`([^`]+)`/g, "<code>$1</code>");
  out = out.replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>");
  out = out.replace(
    /\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g,
    '<a href="$2">$1</a>',
  );
  // Bare URLs — but not ones already inside an href/anchor from the rule above.
  out = out.replace(
    /(^|[\s(])((?:https?:\/\/)[^\s<)]+?)([.,)]?)(?=$|[\s<])/g,
    (_m, pre: string, url: string, trail: string) =>
      `${pre}<a href="${url}">${url}</a>${trail}`,
  );
  return out;
}

function isTableLine(line: string): boolean {
  return /^\|.*\|\s*$/.test(line.trim());
}

function isTableSeparator(line: string): boolean {
  return /^\|[\s\-:|]+\|\s*$/.test(line.trim());
}

function renderTable(lines: string[]): string {
  const rows = lines
    .filter((l) => !isTableSeparator(l))
    .map((l) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((cell) => renderInline(escapeHtml(cell.trim()))),
    );
  const [header, ...body] = rows;
  const th = header.map((c) => `<th>${c}</th>`).join("");
  const trs = body
    .map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join("")}</tr>`)
    .join("\n");
  return `<table>\n<thead><tr>${th}</tr></thead>\n<tbody>\n${trs}\n</tbody>\n</table>`;
}

/** Converts the constrained markdown of PRIVACY.md into body HTML. */
export function renderMarkdownBody(markdown: string): string {
  const lines = markdown.split(/\r?\n/);
  const blocks: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();
    if (trimmed === "") {
      i += 1;
      continue;
    }
    if (trimmed.startsWith("# ")) {
      blocks.push(`<h1>${renderInline(escapeHtml(trimmed.slice(2)))}</h1>`);
      i += 1;
    } else if (trimmed.startsWith("## ")) {
      blocks.push(`<h2>${renderInline(escapeHtml(trimmed.slice(3)))}</h2>`);
      i += 1;
    } else if (trimmed.startsWith("> ") || trimmed === ">") {
      const quote: string[] = [];
      while (i < lines.length && (lines[i].trim().startsWith(">") )) {
        quote.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      const inner = renderMarkdownBody(quote.join("\n"));
      blocks.push(`<blockquote>\n${inner}\n</blockquote>`);
    } else if (trimmed.startsWith("- ")) {
      const items: string[] = [];
      let current = trimmed.slice(2);
      i += 1;
      while (i < lines.length) {
        const next = lines[i];
        if (next.trim().startsWith("- ")) {
          items.push(current);
          current = next.trim().slice(2);
          i += 1;
        } else if (next.trim() !== "" && /^\s+/.test(next)) {
          current += ` ${next.trim()}`;
          i += 1;
        } else {
          break;
        }
      }
      items.push(current);
      const lis = items
        .map((item) => `<li>${renderInline(escapeHtml(item))}</li>`)
        .join("\n");
      blocks.push(`<ul>\n${lis}\n</ul>`);
    } else if (isTableLine(trimmed)) {
      const table: string[] = [];
      while (i < lines.length && isTableLine(lines[i].trim())) {
        table.push(lines[i]);
        i += 1;
      }
      blocks.push(renderTable(table));
    } else if (trimmed.startsWith("```")) {
      const code: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        code.push(lines[i]);
        i += 1;
      }
      i += 1; // closing fence
      blocks.push(`<pre><code>${escapeHtml(code.join("\n"))}</code></pre>`);
    } else {
      const para: string[] = [trimmed];
      i += 1;
      while (
        i < lines.length &&
        lines[i].trim() !== "" &&
        !/^(#|##|>|- |\||```)/.test(lines[i].trim())
      ) {
        para.push(lines[i].trim());
        i += 1;
      }
      let text = para.join(" ");
      const italic = text.match(/^_(.+)_$/);
      const inner = renderInline(escapeHtml(italic ? italic[1] : text));
      blocks.push(`<p>${italic ? `<em>${inner}</em>` : inner}</p>`);
    }
  }
  return blocks.join("\n");
}

/** Strict CSP for the static policy page: no scripts, inline style only. */
export const PRIVACY_PAGE_CSP =
  "default-src 'none'; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'";

const PAGE_STYLE = `
  :root { color-scheme: light; }
  body {
    margin: 0 auto; padding: 32px 20px 64px; max-width: 760px;
    font: 16px/1.6 -apple-system, "Segoe UI", Roboto, sans-serif;
    color: #261b14; background: #fff7ef;
  }
  h1, h2 { line-height: 1.25; }
  h1 { font-size: 28px; }
  h2 { font-size: 20px; margin-top: 2em; }
  a { color: #a05c1c; }
  blockquote {
    margin: 1em 0; padding: 12px 16px; border-left: 4px solid #d89c5b;
    background: #fffaf4; border-radius: 4px;
  }
  blockquote p { margin: 0.4em 0; }
  code { background: #f4e7d7; padding: 1px 5px; border-radius: 4px; font-size: 0.92em; }
  pre { background: #f4e7d7; padding: 12px; border-radius: 6px; overflow-x: auto; }
  pre code { background: none; padding: 0; }
  table { border-collapse: collapse; width: 100%; margin: 1em 0; }
  th, td { border: 1px solid #e4cdb0; padding: 6px 10px; text-align: left; }
  th { background: #fffaf4; }
`;

export function renderPrivacyPage(markdown: string): string {
  const body = renderMarkdownBody(markdown);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="${PRIVACY_PAGE_CSP}">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Collectables — Privacy Policy</title>
<style>${PAGE_STYLE}</style>
</head>
<body>
${body}
</body>
</html>
`;
}
