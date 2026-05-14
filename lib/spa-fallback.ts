// Helpers that generate the GitHub-Pages SPA fallback artefacts. Pure module —
// no `react-native` or DOM imports — so it can be unit-tested from plain Node.
//
// Why this exists: GitHub Pages serves `404.html` with HTTP status 404 for any
// path it cannot resolve to a real file. Dynamic Expo Router routes like
// `/collection/[id]` never resolve, so a deep link returns 404 even though the
// shipped HTML boots the SPA correctly. iOS Safari reacts to that 404 status
// by retrying the page; after three retries it gives up with "A problem
// repeatedly occurred". The redirect dance below sends the browser to the
// baseUrl (which serves with 200) and restores the URL on the next page load.

export const SPA_REDIRECT_STORAGE_KEY = "collectables:spa-redirect";
export const SPA_RESTORE_SCRIPT_MARKER = "data-spa-restore";

export function normalizeSpaBaseUrl(baseUrl: string): string {
  let b = (baseUrl ?? "").trim();
  if (b === "" || b === "/") return "/";
  if (!b.startsWith("/")) b = "/" + b;
  if (!b.endsWith("/")) b += "/";
  return b;
}

export function build404Html(baseUrl: string): string {
  const base = normalizeSpaBaseUrl(baseUrl);
  const storageKey = JSON.stringify(SPA_REDIRECT_STORAGE_KEY);
  const target = JSON.stringify(base);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Collectables</title>
<meta http-equiv="refresh" content="0; url=${base}">
<script>
(function () {
  try {
    sessionStorage.setItem(${storageKey}, location.pathname + location.search + location.hash);
  } catch (e) {}
  location.replace(${target});
})();
</script>
</head>
<body></body>
</html>
`;
}

export function injectSpaRestoreScript(html: string): string {
  if (html.includes(SPA_RESTORE_SCRIPT_MARKER)) return html;
  const storageKey = JSON.stringify(SPA_REDIRECT_STORAGE_KEY);
  const script = `<script ${SPA_RESTORE_SCRIPT_MARKER}>
(function () {
  try {
    var key = ${storageKey};
    var redirect = sessionStorage.getItem(key);
    if (!redirect) return;
    sessionStorage.removeItem(key);
    var current = location.pathname + location.search + location.hash;
    if (redirect !== current && redirect.charAt(0) === "/") {
      history.replaceState(null, "", redirect);
    }
  } catch (e) {}
})();
</script>`;
  if (html.includes("</head>")) {
    return html.replace("</head>", `${script}</head>`);
  }
  return script + html;
}
