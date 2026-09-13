/**
 * Did the exported app actually MOUNT (pure logic — CLI in
 * `scripts/check-bundle-boot.ts`).
 *
 * ## The question nothing else in this repository can answer
 *
 * `check-bundle-smoke` greps the chunks for watched i18n keys and provider
 * names, `check-bundle-size` weighs them, and 9000 cases run against modules a
 * test runner imported. None of them loads the artifact the deploy publishes.
 * Six rounds of suggestions carried "the web app has never been loaded by
 * anything that runs in CI", and two rounds in one morning — the crash shell
 * losing `Sentry.wrap` at the root, and four locale maps moving behind
 * `import()` — were exactly the change where "it compiles and the suites pass"
 * says nothing about whether the tree still mounts. Both were checked by
 * driving Chromium by hand.
 *
 * ## A TOOL, not a gate leg
 *
 * It is not in `npm run verify` and not in ci.yml, and that is a decision
 * rather than an omission: it needs a browser, and a gate that downloads one
 * is a gate that goes red when a download does. The suggestion asking for a
 * tenth leg stands; what this closes is the part that was a chore — nobody
 * should have to re-derive a static server, a base path and a CDP session to
 * answer "does it still boot".
 *
 * ## What counts as a failure, and what deliberately does not
 *
 * A page error, a console error, a same-origin request that 404s, and an empty
 * root are failures: each of them means the app the deploy serves is broken.
 * A request to ANOTHER origin is not — Supabase, a font CDN and an analytics
 * host are all unreachable from a sandbox with no internet, and a check that
 * reddened on that would be a check about the network rather than about the
 * bundle. The rule is written here, with the observation it rules on, rather
 * than inside a browser callback where it cannot be tested.
 */

export type BootRequestFailure = {
  readonly url: string;
  /** HTTP status, or null when the request never got one (DNS, refused, …). */
  readonly status: number | null;
};

export type BootObservation = {
  /** Uncaught exceptions the page threw. */
  readonly pageErrors: readonly string[];
  /** `console.error` calls the page made. */
  readonly consoleErrors: readonly string[];
  /** Requests that failed, whatever their origin. */
  readonly failedRequests: readonly BootRequestFailure[];
  /** Characters of markup inside the root element after the load settled. */
  readonly rootHtmlLength: number;
  /** The visible text, for the report — never a pass/fail input. */
  readonly bodyText: string;
  /** Basenames of the `_expo` chunks the page fetched, in request order. */
  readonly chunksFetched: readonly string[];
};

export type BootFailure = { readonly kind: string; readonly detail: string };

export type BootResult = {
  readonly ok: boolean;
  readonly failures: readonly BootFailure[];
  readonly observation: BootObservation;
};

/**
 * The smallest amount of markup a mounted tree can produce.
 *
 * The auth screen — what an unconfigured install renders — is about 3 KB of
 * markup. A React root that threw during render leaves the element empty, and
 * one that rendered a fallback leaves a few hundred characters, so the bar is
 * set well under the real number and well over both failures.
 */
export const MIN_ROOT_HTML_LENGTH = 200;

/** Whether a URL is served by the page's own origin. */
export function isSameOrigin(url: string, origin: string): boolean {
  return url === origin || url.startsWith(`${origin}/`);
}

export function evaluateBundleBoot(
  observation: BootObservation,
  origin: string,
): BootResult {
  const failures: BootFailure[] = [];

  for (const message of observation.pageErrors) {
    failures.push({ kind: "page error", detail: message });
  }
  for (const message of observation.consoleErrors) {
    failures.push({ kind: "console error", detail: message });
  }
  for (const request of observation.failedRequests) {
    // Another origin is the network's problem, not the bundle's. The app talks
    // to Supabase and a font host, and neither is reachable from a sandbox.
    if (!isSameOrigin(request.url, origin)) continue;
    const status = request.status === null ? "no response" : `HTTP ${String(request.status)}`;
    failures.push({ kind: "request failed", detail: `${status} — ${request.url}` });
  }
  if (observation.rootHtmlLength < MIN_ROOT_HTML_LENGTH) {
    failures.push({
      kind: "empty root",
      detail: `${String(observation.rootHtmlLength)} characters of markup, under the ${String(MIN_ROOT_HTML_LENGTH)} a mounted tree produces`,
    });
  }

  return { ok: failures.length === 0, failures, observation };
}

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

export function formatBundleBootReport(checkName: string, result: BootResult): string {
  const { observation } = result;
  const lines = [
    `${checkName}: fetched ${String(observation.chunksFetched.length)} chunk(s): ${observation.chunksFetched.join(", ")}`,
  ];
  if (result.ok) {
    lines.push(
      `${checkName}: OK — the tree mounted (${String(observation.rootHtmlLength)} characters of markup).`,
      // The first line of what a human would SEE, so a boot that mounts the
      // wrong thing — an error screen, an untranslated key — is visible rather
      // than merely counted.
      `${checkName}: first line on screen: ${JSON.stringify(firstLine(observation.bodyText))}`,
    );
    return lines.join("\n");
  }
  lines.push(`${checkName}: FAIL — ${String(result.failures.length)} problem(s) loading the exported app:`);
  for (const failure of result.failures) {
    lines.push(`  ${failure.kind}: ${failure.detail}`);
  }
  lines.push(
    "This is the artifact the deploy publishes, loaded in a real browser — a",
    "failure here is a broken site, not a broken test. `npm run build` first if",
    "dist/ is stale.",
  );
  return lines.join("\n");
}
