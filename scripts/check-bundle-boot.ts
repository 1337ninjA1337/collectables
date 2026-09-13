#!/usr/bin/env tsx
/**
 * Loads the exported web app in a real browser and says whether it mounted.
 *
 * Run it after `npm run build`:
 *
 * ```
 * npm run check:boot
 * ```
 *
 * A TOOL, not a gate leg — see `lib/bundle-boot.ts` for why it is deliberately
 * out of `npm run verify`, and for the rule about which failures count.
 *
 * ## No new dependency, deliberately
 *
 * Chromium speaks the DevTools Protocol over a WebSocket, and Node 22 has a
 * WebSocket client built in. Playwright would be a nicer API and a devDependency
 * this repository would then audit, update and ship the lockfile for — for a
 * script that navigates to one URL and reads four things back.
 *
 * ## The base path is read, not assumed
 *
 * `app.json`'s `experiments.baseUrl` is `/collectables`, and the export's
 * asset URLs are absolute from it — serving `dist/` at `/` produces a page
 * that 500s on its own entry chunk, which is what the first hand-run of this
 * check did. The server below strips that prefix, so the page is loaded at the
 * path the deploy actually uses.
 */

import { spawn, type ChildProcess } from "node:child_process";
import * as fs from "node:fs";
import * as http from "node:http";
import * as path from "node:path";

import {
  BOOT_SCENARIOS,
  evaluateBundleBoot,
  formatBundleBootReport,
  isSpaRouteRequest,
  toBootRequestFailure,
  type BootRequestFailure,
  type BootScenario,
} from "../lib/bundle-boot";
import { REPO_ROOT, assertBundlePremise } from "./bundle-premise";

const CHECK_NAME = "check-bundle-boot";

/** How long the page gets to load and settle, in milliseconds. */
const LOAD_TIMEOUT_MS = 30_000;
const SETTLE_MS = 1_500;

const MIME: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".ttf": "font/ttf",
  ".woff2": "font/woff2",
  ".webmanifest": "application/manifest+json",
};

/** Where the deploy serves the app from, read from the Expo config. */
function readBaseUrl(): string {
  const appJson = JSON.parse(
    fs.readFileSync(path.join(REPO_ROOT, "app.json"), "utf8"),
  ) as { expo?: { experiments?: { baseUrl?: string } } };
  return appJson.expo?.experiments?.baseUrl ?? "";
}

/** Every candidate Chromium, most specific first. */
function findBrowser(): string | null {
  const candidates = [
    process.env.CHROME_PATH,
    process.env.PLAYWRIGHT_BROWSERS_PATH
      ? path.join(process.env.PLAYWRIGHT_BROWSERS_PATH, "chromium")
      : null,
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
    "/usr/bin/google-chrome",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  ].filter((candidate): candidate is string => typeof candidate === "string" && candidate !== "");
  return candidates.find((candidate) => fs.existsSync(candidate)) ?? null;
}

function serveDist(baseUrl: string): Promise<{ origin: string; close: () => void }> {
  const root = path.join(REPO_ROOT, "dist");
  const server = http.createServer((req, res) => {
    let requested = decodeURIComponent((req.url ?? "/").split("?")[0]);
    if (baseUrl && requested.startsWith(baseUrl)) requested = requested.slice(baseUrl.length);
    if (requested === "" || requested === "/") requested = "/index.html";
    let file = path.join(root, requested);
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
      // The SPA fallback the deploy uses — for a ROUTE. A file that is missing
      // from dist/ gets the 404 it would get in production rather than a page
      // of HTML with a `.js` content type, which is a syntax error one step
      // removed from the thing that is actually wrong.
      if (!isSpaRouteRequest(requested)) {
        res.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        res.end(`not in dist/: ${requested}`);
        return;
      }
      file = path.join(root, "index.html");
    }
    res.writeHead(200, {
      "content-type": MIME[path.extname(file)] ?? "application/octet-stream",
    });
    fs.createReadStream(file).pipe(res);
  });
  return new Promise((resolve) => {
    // Port 0: the OS picks a free one, so two runs at once cannot collide.
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({
        origin: `http://127.0.0.1:${String(port)}`,
        close: () => server.close(),
      });
    });
  });
}

/** Starts headless Chromium and resolves its DevTools WebSocket endpoint. */
function startBrowser(executable: string): Promise<{ ws: string; child: ChildProcess }> {
  const child = spawn(executable, [
    "--headless=new",
    "--no-sandbox",
    "--disable-gpu",
    "--remote-debugging-port=0",
    "--user-data-dir=" + fs.mkdtempSync(path.join(REPO_ROOT, "node_modules", ".boot-profile-")),
    "about:blank",
  ]);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error("the browser printed no DevTools endpoint within 15s"));
    }, 15_000);
    let buffered = "";
    child.stderr.on("data", (chunk: Buffer) => {
      buffered += chunk.toString();
      const match = /ws:\/\/[^\s]+/.exec(buffered);
      if (match) {
        clearTimeout(timer);
        resolve({ ws: match[0], child });
      }
    });
    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

type CdpMessage = { id?: number; method?: string; params?: Record<string, unknown> };

async function boot(origin: string, wsUrl: string, scenario: BootScenario) {
  const socket = new WebSocket(wsUrl);
  await new Promise((resolve, reject) => {
    socket.addEventListener("open", resolve, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });

  let nextId = 0;
  const pending = new Map<number, (result: Record<string, unknown>) => void>();
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  const failedRequests: BootRequestFailure[] = [];
  const chunksFetched: string[] = [];
  // `Network.loadingFailed` carries a request id and no URL, so the URL has to
  // come from the event that sent the request out. A redirect reuses the id and
  // overwrites the entry, which is what the report wants: the hop that failed.
  const requestUrls = new Map<string, string>();
  // A request can both answer 4xx and then fail; it is one broken request.
  const reportedRequests = new Set<string>();

  socket.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as CdpMessage & {
      result?: Record<string, unknown>;
    };
    if (typeof message.id === "number") {
      pending.get(message.id)?.(message.result ?? {});
      pending.delete(message.id);
      return;
    }
    const params = message.params ?? {};
    switch (message.method) {
      case "Runtime.exceptionThrown": {
        const details = params.exceptionDetails as { text?: string; exception?: { description?: string } };
        pageErrors.push(details.exception?.description ?? details.text ?? "unknown exception");
        break;
      }
      case "Runtime.consoleAPICalled": {
        if (params.type !== "error") break;
        const args = (params.args ?? []) as { value?: unknown; description?: string }[];
        consoleErrors.push(
          args.map((arg) => String(arg.value ?? arg.description ?? "")).join(" ").trim(),
        );
        break;
      }
      case "Network.requestWillBeSent": {
        const url = String((params.request as { url?: string }).url ?? "");
        if (url.includes("/_expo/")) chunksFetched.push(url.split("/").pop() ?? url);
        if (typeof params.requestId === "string") requestUrls.set(params.requestId, url);
        break;
      }
      case "Network.responseReceived": {
        const response = params.response as { url?: string; status?: number };
        if ((response.status ?? 200) >= 400) {
          if (typeof params.requestId === "string") reportedRequests.add(params.requestId);
          failedRequests.push({ url: String(response.url), status: response.status ?? null });
        }
        break;
      }
      case "Network.loadingFailed": {
        // A request that DIED — DNS, refused, reset, a server that never
        // answered. Everything but the id is on the event; the URL comes from
        // the map above, and the rule about which of these is the bundle's
        // problem lives in `lib/bundle-boot.ts` where it can be tested.
        const requestId = typeof params.requestId === "string" ? params.requestId : null;
        if (requestId !== null && reportedRequests.has(requestId)) break;
        if (requestId !== null) reportedRequests.add(requestId);
        const failure = toBootRequestFailure({
          url: requestId === null ? null : (requestUrls.get(requestId) ?? null),
          errorText: String(params.errorText ?? "unknown network error"),
          canceled: params.canceled === true,
        });
        if (failure) failedRequests.push(failure);
        break;
      }
      default:
        break;
    }
  });

  const send = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = (nextId += 1);
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params }));
    });

  // A fresh target, so nothing from about:blank is in the transcript.
  const target = (await send("Target.createTarget", { url: "about:blank" })) as {
    targetId?: string;
  };
  const session = (await send("Target.attachToTarget", {
    targetId: target.targetId,
    flatten: true,
  })) as { sessionId?: string };
  const sessionId = session.sessionId;

  const sendToPage = (method: string, params: Record<string, unknown> = {}) =>
    new Promise<Record<string, unknown>>((resolve) => {
      const id = (nextId += 1);
      pending.set(id, resolve);
      socket.send(JSON.stringify({ id, method, params, sessionId }));
    });

  await sendToPage("Page.enable");
  await sendToPage("Runtime.enable");
  await sendToPage("Network.enable");

  // Seeded BEFORE the page's first script, because the app reads the language
  // once on mount: a write after the load would be testing a language CHANGE,
  // which is a different thing from booting in that language. The origin is
  // this run's own server, so nothing here outlives the process.
  //
  // CLEARED FIRST, AND FOR EVERY SCENARIO, including the ones that seed
  // nothing. A new target is not a new origin: the first run of this loop left
  // `pl` in storage and the scenario after it — which seeds nothing and is
  // supposed to boot the default language — fetched the Polish chunk and
  // rendered "KONTO COLLECTABLES". A scenario that inherits the previous one's
  // state is not the scenario it says it is.
  await sendToPage("Page.addScriptToEvaluateOnNewDocument", {
    source: [
      "localStorage.clear();",
      ...Object.entries(scenario.storage).map(
        ([key, value]) =>
          `localStorage.setItem(${JSON.stringify(key)}, ${JSON.stringify(value)});`,
      ),
    ].join("\n"),
  });

  const loaded = new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const message = JSON.parse(String(event.data)) as CdpMessage;
      if (message.method === "Page.loadEventFired") {
        socket.removeEventListener("message", onMessage);
        resolve();
      }
    };
    socket.addEventListener("message", onMessage);
  });

  await sendToPage("Page.navigate", { url: `${origin}${readBaseUrl()}${scenario.path}` });
  await Promise.race([
    loaded,
    new Promise<void>((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS)),
  ]);
  // The tree mounts in an effect after the load event; a fixed settle is crude
  // and honest, and the alternative — polling for markup — would make the
  // check pass by waiting for the thing it is asking about.
  await new Promise((resolve) => setTimeout(resolve, SETTLE_MS));

  const evaluate = async (expression: string) => {
    const result = (await sendToPage("Runtime.evaluate", {
      expression,
      returnByValue: true,
    })) as { result?: { value?: unknown } };
    return result.result?.value;
  };

  const rootHtmlLength = Number(
    (await evaluate("document.getElementById('root')?.innerHTML.length ?? 0")) ?? 0,
  );
  const bodyText = String((await evaluate("document.body.innerText.slice(0, 400)")) ?? "");

  // The target goes with the socket: three scenarios would otherwise leave
  // three pages open in one browser, each still running the app it loaded.
  await send("Target.closeTarget", { targetId: target.targetId });
  socket.close();
  return { pageErrors, consoleErrors, failedRequests, rootHtmlLength, bodyText, chunksFetched };
}

async function main(): Promise<void> {
  // The same premise every post-build reader shares: a `dist/` older than the
  // source tree would boot yesterday's app with today's confidence.
  assertBundlePremise(CHECK_NAME);

  const executable = findBrowser();
  if (!executable) {
    console.error(
      `${CHECK_NAME}: no Chromium found. Set CHROME_PATH to a Chrome or Chromium binary`,
      "(or PLAYWRIGHT_BROWSERS_PATH to a directory containing one) and run it again.",
    );
    process.exit(1);
  }

  const server = await serveDist(readBaseUrl());
  let browser: ChildProcess | null = null;
  try {
    const started = await startBrowser(executable);
    browser = started.child;
    // One browser, one target per scenario: a fresh target is what makes the
    // seeded language a boot rather than a reload, and starting three browsers
    // would pay the launch three times for nothing.
    for (const scenario of BOOT_SCENARIOS) {
      const observation = await boot(server.origin, started.ws, scenario);
      const result = evaluateBundleBoot(
        observation,
        server.origin,
        readBaseUrl(),
        scenario,
      );
      console[result.ok ? "log" : "error"](
        formatBundleBootReport(CHECK_NAME, result, scenario.name),
      );
      // Every scenario runs even after one fails: a run that stopped at the
      // first would cost a second build to find out whether the other two are
      // broken too.
      if (!result.ok) process.exitCode = 1;
    }
  } finally {
    browser?.kill();
    server.close();
  }
}

void main();
