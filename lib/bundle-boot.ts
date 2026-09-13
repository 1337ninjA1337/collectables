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
 * A page error, a console error, a same-origin request that 404s, a same-origin
 * request that never answered at all, and an empty root are failures: each of
 * them means the app the deploy serves is broken. A request to ANOTHER origin
 * is not — Supabase, a font CDN and an analytics host are all unreachable from
 * a sandbox with no internet, and a check that reddened on that would be a
 * check about the network rather than about the bundle. The rule is written
 * here, with the observation it rules on, rather than inside a browser callback
 * where it cannot be tested.
 *
 * The "never answered" half arrived a round later, and its absence had a
 * consequence worth keeping written down: `Network.loadingFailed` carries no
 * URL, so the first version dropped it, and a lazy locale chunk that was never
 * served failed as an empty screen rather than as "the chunk did not arrive".
 * `toBootRequestFailure` is where that event becomes a failure — or, for a
 * cancelled or unattributable one, does not.
 */

export type BootRequestFailure = {
  readonly url: string;
  /** HTTP status, or null when the request never got one (DNS, refused, …). */
  readonly status: number | null;
  /** Chromium's reason when there was no response — `net::ERR_…`. */
  readonly errorText?: string;
};

/**
 * A `Network.loadingFailed` event, flattened to the three things that decide
 * whether it is a broken bundle.
 *
 * `url` is null when the request id was never seen going out: the event itself
 * carries no URL, which is the reason this class of failure was dropped by the
 * first version of the check.
 */
export type LoadingFailedEvent = {
  readonly url: string | null;
  readonly errorText: string;
  readonly canceled: boolean;
};

/** What Chromium reports for a request the page itself called off. */
const ABORTED = "net::ERR_ABORTED";

/**
 * The failure a `Network.loadingFailed` event stands for, or null when it is
 * not the bundle's problem.
 *
 * Two things are deliberately dropped. A CANCELLED request is the page's own
 * doing — an effect that unmounted, a fetch the app aborted — and reporting it
 * would redden the check on ordinary React behaviour. An UNATTRIBUTABLE one
 * (no `requestWillBeSent` for the id, so no URL) cannot be tested against the
 * origin, and the requests this check ignores are exactly the ones that fail
 * without a response in a sandbox: Supabase, a font host, an analytics
 * endpoint. Reporting those would make this a check about the network.
 */
export function toBootRequestFailure(event: LoadingFailedEvent): BootRequestFailure | null {
  if (event.canceled || event.errorText === ABORTED) return null;
  if (event.url === null) return null;
  return { url: event.url, status: null, errorText: event.errorText };
}

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

/**
 * Whether a path the export does not contain is a ROUTE or a MISSING FILE.
 *
 * The deploy's SPA fallback is what makes `/collectables/item/abc` work: GitHub
 * Pages answers an unresolved path with `404.html`, which is a copy of the
 * shell, and the router takes it from there. Applying that to EVERY unresolved
 * path — which the check's server did — hands a chunk missing from `dist/` a
 * page of HTML with a 200 on it, and the browser then reports a syntax error
 * in a JavaScript file that is really an HTML document. The last segment
 * decides: something with a dot in it was asked for as a file.
 *
 * Pages answers routes with a 404 status too, and this server answers them 200.
 * That is deliberate: the status of the shell is the deploy's routing, and a
 * boot check that reddened on it would be saying nothing about the bundle.
 */
export function isSpaRouteRequest(pathname: string): boolean {
  const lastSegment = pathname.split("/").pop() ?? "";
  return !lastSegment.includes(".");
}

/** Whether a URL is served by the page's own origin. */
export function isSameOrigin(url: string, origin: string): boolean {
  return url === origin || url.startsWith(`${origin}/`);
}

/**
 * Whether a URL is part of the artifact under test.
 *
 * Same-origin is not quite the boundary. The deploy serves the app under
 * `experiments.baseUrl`, and what sits at the DOMAIN root belongs to whoever
 * owns the domain — Chromium asks every origin for `/favicon.ico` whether the
 * page mentions one or not, and this export ships no favicon at all. Counting
 * that probe would fail every healthy boot for something the deploy does not
 * publish. An empty base path means the app is the whole origin.
 */
export function isBundleRequest(url: string, origin: string, basePath: string): boolean {
  if (!isSameOrigin(url, origin)) return false;
  if (basePath === "") return true;
  const pathname = url.slice(origin.length);
  return pathname === basePath || pathname.startsWith(`${basePath}/`);
}

export function evaluateBundleBoot(
  observation: BootObservation,
  origin: string,
  basePath = "",
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
    if (!isBundleRequest(request.url, origin, basePath)) continue;
    const status =
      request.status === null
        ? // Why it never answered, when Chromium said: "no response" alone
          // reads as a slow chunk, and `net::ERR_CONNECTION_REFUSED` does not.
          `no response${request.errorText ? ` (${request.errorText})` : ""}`
        : `HTTP ${String(request.status)}`;
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
