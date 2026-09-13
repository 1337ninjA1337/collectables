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

import { LANGUAGE_KEY } from "@/lib/storage-keys";

/**
 * One thing to load, and what loading it proves.
 *
 * The first version of this check booted ONE page — `/`, signed out, in the
 * default language — because that is what an unconfigured install renders. It
 * is also the one page whose copy is in the entry chunk and whose route is the
 * one the server has a file for, so the two things that broke this year were
 * both outside it: four locale maps moving behind `import()`, and the router
 * answering a path that only exists as an SPA fallback.
 *
 * `storage` is seeded BEFORE the first script runs, because the language is
 * read once on mount: writing it after the load would test a language change
 * rather than a boot in that language. On the web AsyncStorage is
 * `localStorage`, and it stores the language code as it is.
 */
export type BootScenario = {
  /** What this run is called in the report. */
  readonly name: string;
  /** Appended to the deploy's base path — `/` is the home screen. */
  readonly path: string;
  /** `localStorage` entries to seed before the page's first script runs. */
  readonly storage: Readonly<Record<string, string>>;
  /**
   * A chunk basename this scenario MUST cause the page to fetch.
   *
   * The Polish boot is the only thing in this repository that proves a lazy
   * locale chunk is reachable at all: without it, a `pl` that silently fell
   * back to the default copy would render a mounted, non-empty, error-free
   * tree in the wrong language, and every check here would pass.
   */
  readonly expectChunk?: RegExp;
  /**
   * Copy that must appear on screen — the app's own words, in the language
   * this scenario asked for.
   *
   * `expectChunk` proves a locale chunk ARRIVED; this proves it was RENDERED.
   * They are different claims: a registry that fetched `pl` and kept the
   * default map would satisfy the first one completely. The value is a short
   * fragment of `authAccount`, the auth screen's heading, and
   * `bundle-boot.test.ts` holds it against the locale maps so a re-worded
   * heading is a red case rather than a red check.
   */
  readonly expectText?: string;
};

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
  /**
   * The visible text: the report's "first line on screen", and — since
   * scenarios began asking for a language — what `expectText` is checked
   * against.
   */
  readonly bodyText: string;
  /** Basenames of the `_expo` chunks the page fetched, in request order. */
  readonly chunksFetched: readonly string[];
};

/**
 * What `npm run check:boot` loads, in order.
 *
 * Three, and each one is a thing the others cannot see:
 *
 *  - `home` is the original: the entry chunk, the provider tree, the default
 *    copy, on the path the server has a file for.
 *  - `polish` is the lazy-locale half. It is the only check anywhere that a
 *    locale chunk is REACHABLE — a `pl` that fell back to the Russian copy
 *    would mount, fill the root and log nothing, and pass every other rule
 *    here. `expectChunk` is what turns that into a failure.
 *  - `deep link` is the SPA fallback. Every route but `/` exists only because
 *    the server answers an unresolved path with the shell, and a router that
 *    could not mount one would be invisible to a check that only ever asks for
 *    the home screen. The id is deliberately one no seed contains: an unknown
 *    item is a route the app is expected to handle, not an error.
 *
 * `LANGUAGE_KEY` is imported rather than spelled so a renamed key breaks the
 * seed loudly instead of booting the default language under a Polish label.
 */
export const BOOT_SCENARIOS: readonly BootScenario[] = [
  // "Аккаунт" — `authAccount` in the default language, which is in the entry
  // chunk. It says the copy rendered rather than merely loaded.
  { name: "home", path: "/", storage: {}, expectText: "Аккаунт" },
  {
    name: "polish",
    path: "/",
    storage: { [LANGUAGE_KEY]: "pl" },
    expectChunk: /^pl-/,
    // "Konto" — the same heading in Polish. Without it a registry that
    // fetched the chunk and kept the default map would pass every rule here.
    expectText: "Konto",
  },
  {
    name: "deep link",
    path: "/item/not-a-real-item",
    storage: {},
    // Back to the default language: this scenario is about the SPA fallback,
    // and the text is what proves storage was cleared after the Polish run.
    expectText: "Аккаунт",
  },
];

/**
 * Every kind of failure this module reports, named once.
 *
 * They are named rather than spelled at each push site because the poll below
 * SORTS them: three of the six are conditions more waiting could still clear,
 * and three are events that never un-happen. A kind spelled in two places is a
 * kind that can drift out of that classification silently — the poll would then
 * sit out its whole deadline on a page error, or, worse, stop early on a tree
 * that had simply not mounted yet.
 */
export const BOOT_FAILURE_KINDS = {
  chunkNotFetched: "chunk not fetched",
  copyNotOnScreen: "copy not on screen",
  pageError: "page error",
  consoleError: "console error",
  requestFailed: "request failed",
  emptyRoot: "empty root",
} as const;

export type BootFailureKind = (typeof BOOT_FAILURE_KINDS)[keyof typeof BOOT_FAILURE_KINDS];

/**
 * The failures that are a "not yet", rather than a "no".
 *
 * The tree mounts in an effect after the load event, the copy appears when it
 * renders, and a lazy locale chunk is requested when the registry asks for it —
 * all three are things that arrive LATE, and all three are the check's own
 * subject. Everything else is an event the browser already reported: an
 * exception was thrown, a console error was logged, a request came back 404.
 * No amount of waiting takes one of those back.
 */
export const WAITABLE_BOOT_FAILURE_KINDS: readonly BootFailureKind[] = [
  BOOT_FAILURE_KINDS.chunkNotFetched,
  BOOT_FAILURE_KINDS.copyNotOnScreen,
  BOOT_FAILURE_KINDS.emptyRoot,
];

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

/** What a scenario claims its boot will produce, beyond merely mounting. */
export type BootExpectation = Pick<BootScenario, "expectChunk" | "expectText">;

export function evaluateBundleBoot(
  observation: BootObservation,
  origin: string,
  basePath = "",
  expect: BootExpectation = {},
): BootResult {
  const failures: BootFailure[] = [];
  const { expectChunk, expectText } = expect;

  // A scenario that exists to prove a chunk is reachable has to say so: the
  // Polish boot mounts, fills the root and logs nothing whether the locale
  // arrived or silently fell back to the default copy.
  if (expectChunk && !observation.chunksFetched.some((chunk) => expectChunk.test(chunk))) {
    failures.push({
      kind: BOOT_FAILURE_KINDS.chunkNotFetched,
      detail: `nothing matching ${String(expectChunk)} was requested — fetched ${observation.chunksFetched.join(", ") || "nothing"}`,
    });
  }

  // ARRIVED is not RENDERED. A registry that fetched the Polish chunk and kept
  // the default map satisfies the rule above completely, and the app it serves
  // is in the wrong language.
  //
  // CASE-INSENSITIVE, because the auth heading is uppercased by a style and
  // `innerText` reports what is on screen: the copy says "Аккаунт" and the page
  // says "АККАУНТ". The expectation is written the way the locale map writes
  // it, so the case that holds the two together compares like with like.
  if (
    expectText !== undefined &&
    !observation.bodyText.toLowerCase().includes(expectText.toLowerCase())
  ) {
    failures.push({
      kind: BOOT_FAILURE_KINDS.copyNotOnScreen,
      detail: `${JSON.stringify(expectText)} is not in what the page rendered — first line was ${JSON.stringify(firstLine(observation.bodyText))}`,
    });
  }

  for (const message of observation.pageErrors) {
    failures.push({ kind: BOOT_FAILURE_KINDS.pageError, detail: message });
  }
  for (const message of observation.consoleErrors) {
    failures.push({ kind: BOOT_FAILURE_KINDS.consoleError, detail: message });
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
    failures.push({ kind: BOOT_FAILURE_KINDS.requestFailed, detail: `${status} — ${request.url}` });
  }
  if (observation.rootHtmlLength < MIN_ROOT_HTML_LENGTH) {
    failures.push({
      kind: BOOT_FAILURE_KINDS.emptyRoot,
      detail: `${String(observation.rootHtmlLength)} characters of markup, under the ${String(MIN_ROOT_HTML_LENGTH)} a mounted tree produces`,
    });
  }

  return { ok: failures.length === 0, failures, observation };
}

/**
 * How long a boot gets to settle, and how often it is asked, in milliseconds.
 *
 * The check waited a flat 1.5 seconds after the load event for its whole life,
 * under a comment saying a fixed settle is "crude and honest" and that polling
 * for markup "would make the check pass by waiting for the thing it is asking
 * about". The first half was true and the second is the thing this pair is
 * built around — see `isBootPollFinished`.
 *
 * The deadline is longer than the flat wait was, deliberately: what it costs is
 * paid only by a boot that is already failing, and what it buys is a run that
 * stops guessing. 1.5 seconds was a number somebody picked once, on one
 * machine, before the check grew a lazy locale chunk and a third scenario — the
 * shape of the failure it was one bad connection away from is "the chunk was
 * slow, so the app is broken", which is a lie this check should never tell.
 */
export const BOOT_SETTLE_DEADLINE_MS = 10_000;
export const BOOT_SETTLE_POLL_MS = 100;

/**
 * Whether waiting longer could still change this verdict.
 *
 * THE POLL IS NOT ALLOWED TO DECIDE ANYTHING, which is the whole answer to the
 * objection the fixed wait was written under. Every condition it waits for is
 * one the verdict FAILS on, so a boot that never satisfies them is failed by
 * `evaluateBundleBoot` at the deadline exactly as it was failed at 1.5 seconds.
 * Polling changes when the answer is read, never what it is: a healthy boot is
 * read the moment it is healthy instead of at a fixed time after the load, and
 * a broken one is read after it has had every chance the deadline allows.
 *
 * It also stops EARLY on a failure that is already final. An exception, a
 * console error or a 404 on a chunk is an event the browser has reported and
 * cannot un-report, so a run that has seen one has its answer — sitting out the
 * remaining nine seconds would only make the report slower to say so.
 */
export function isBootPollFinished(result: BootResult): boolean {
  if (result.ok) return true;
  return result.failures.some(
    (failure) => !WAITABLE_BOOT_FAILURE_KINDS.includes(failure.kind as BootFailureKind),
  );
}

function firstLine(text: string): string {
  const line = text.split("\n").find((candidate) => candidate.trim().length > 0) ?? "";
  return line.length > 120 ? `${line.slice(0, 117)}…` : line;
}

export function formatBundleBootReport(
  checkName: string,
  result: BootResult,
  scenario?: string,
): string {
  const { observation } = result;
  // The scenario name, when there is more than one boot in a run: three reports
  // that all begin "check-bundle-boot: OK" say nothing about which page each
  // one loaded.
  const label = scenario === undefined ? checkName : `${checkName} [${scenario}]`;
  const lines = [
    `${label}: fetched ${String(observation.chunksFetched.length)} chunk(s): ${observation.chunksFetched.join(", ")}`,
  ];
  if (result.ok) {
    lines.push(
      `${label}: OK — the tree mounted (${String(observation.rootHtmlLength)} characters of markup).`,
      // The first line of what a human would SEE, so a boot that mounts the
      // wrong thing — an error screen, an untranslated key — is visible rather
      // than merely counted.
      `${label}: first line on screen: ${JSON.stringify(firstLine(observation.bodyText))}`,
    );
    return lines.join("\n");
  }
  lines.push(`${label}: FAIL — ${String(result.failures.length)} problem(s) loading the exported app:`);
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
