/**
 * Calling a Supabase Edge Function, and what comes back — as a pure module,
 * so the answer to "what does a network failure do here" can be RUN.
 *
 * ## The bug this was extracted for
 *
 * `deleteAccountViaEdgeFunction` and `deleteImagesViaEdgeFunction` in
 * `lib/supabase-profiles.ts` were the same fetch envelope written twice: the
 * same URL template, the same four headers, the same
 * `res.json().catch(…)` error read. Only ONE of them wrapped it in a `try`.
 *
 * So a `fetch` REJECTION — offline, DNS, TLS, a CORS preflight refused, which
 * iOS Safari 18 produces often enough that `supabaseRest` has a comment about
 * it — returned `{ deleted: 0, error }` from the image deleter and THREW out
 * of the account deleter, whose own signature promises `{ error?: string }`.
 *
 * Nothing on that path catches. `lib/auth-context.tsx`' `deleteAccount` is
 * `try { … } finally { setPending(false) }`; `app/settings.tsx`'
 * `performDelete` is `try { … } finally { setDeleting(false) }`. No `catch` in
 * either. A user who tapped "Delete account" with no connection watched the
 * spinner stop and got nothing at all — no alert, no navigation — and
 * `deleteAccountFailed`, which exists in all six locales, was unreachable on
 * the one screen whose failure matters most.
 *
 * ## Why this module exists rather than one `try` added in place
 *
 * The asymmetry was invisible because each function read correctly on its own;
 * what was wrong was that two of them disagreed, and nothing could compare
 * them. `lib/supabase-profiles.ts` reaches `fetch`, the Supabase auth client
 * and the env config directly, so no suite imports it — every case about that
 * module reads its SOURCE TEXT, which is exactly the kind of case that cannot
 * see a missing `try`.
 *
 * Here the transport is a parameter. A suite hands in a fake that rejects and
 * asserts the result, which is the claim the two call sites used to disagree
 * about, now stated once and executable.
 */

/** What an Edge Function call came back as: a parsed body, or a reason. */
export type EdgeFunctionResult =
  | { readonly ok: true; readonly body: unknown }
  | { readonly ok: false; readonly error: string };

/** The part of a `Response` this caller reads. */
export interface EdgeFunctionResponse {
  readonly ok: boolean;
  json(): Promise<unknown>;
}

/** The part of `fetch` this caller uses — the seam a suite substitutes. */
export type EdgeFunctionFetch = (
  url: string,
  init: { method: string; headers: Record<string, string>; body?: string },
) => Promise<EdgeFunctionResponse>;

/** Everything the call needs from its environment, passed rather than imported. */
export interface EdgeFunctionTransport {
  /** The Supabase project URL, with no trailing slash. */
  readonly baseUrl: string;
  /** The publishable key, sent as `apikey`. */
  readonly apiKey: string;
  /** The current session's access token, or `null` when there is no session. */
  readonly token: () => Promise<string | null>;
  readonly fetch: EdgeFunctionFetch;
}

/**
 * The diagnostic string an Edge Function failure falls back to.
 *
 * Both call sites today are deletions and both used this exact sentence. It is
 * never shown to a user: `app/settings.tsx` reports `t("deleteAccountFailed")`
 * and `deleteCloudinaryImages` treats a failure as non-fatal, so this is a
 * breadcrumb for a log rather than copy. The day a non-deletion Edge Function
 * joins, it becomes a parameter rather than a constant that quietly lies.
 */
export const EDGE_FUNCTION_FALLBACK_ERROR = "Deletion failed";

/** The reason given when there is no session to call with. */
export const EDGE_FUNCTION_NO_SESSION = "No session";

/** Where an Edge Function lives, from the project URL and its name. */
export function edgeFunctionUrl(baseUrl: string, name: string): string {
  return `${baseUrl}/functions/v1/${name}`;
}

/**
 * The `error` of a failure body, when the server actually sent a string.
 *
 * `res.json()` is `any`, so the previous `data.error ?? "Deletion failed"`
 * would have passed an object or an array straight through as an error
 * message. Nothing renders it today, which is precisely why nobody would have
 * noticed: the type check is here so the fallback means "the server did not
 * say" rather than "the server said something unprintable".
 */
export function edgeFunctionError(payload: unknown): string {
  const error = (payload as { error?: unknown } | null | undefined)?.error;
  return typeof error === "string" && error.length > 0 ? error : EDGE_FUNCTION_FALLBACK_ERROR;
}

/**
 * The `deleted` count of a success body, when the server sent a number.
 *
 * Zero for anything else — an absent field, a string, an unparseable body.
 * The caller treats the count as best-effort (an orphaned Cloudinary asset is
 * not a data-loss bug), so a missing number is "none reported" rather than an
 * error worth surfacing.
 */
export function edgeFunctionDeletedCount(body: unknown): number {
  const deleted = (body as { deleted?: unknown } | null | undefined)?.deleted;
  return typeof deleted === "number" && Number.isFinite(deleted) ? deleted : 0;
}

/**
 * POST to an Edge Function and come back with a result rather than an
 * exception.
 *
 * Every failure is a value: no session, a non-OK status, an unparseable body,
 * and a rejected transport. That last one is the bug this module exists for,
 * and it is the only one of the four that used to depend on which call site
 * you were reading.
 *
 * The body is omitted entirely when there is none, rather than sent as
 * `"undefined"` or `"null"`: `delete-account` takes no arguments, and a
 * body-less POST is what it was always sent.
 */
export async function callEdgeFunction(
  transport: EdgeFunctionTransport,
  name: string,
  body?: unknown,
): Promise<EdgeFunctionResult> {
  const token = await transport.token();
  if (!token) return { ok: false, error: EDGE_FUNCTION_NO_SESSION };
  try {
    const res = await transport.fetch(edgeFunctionUrl(transport.baseUrl, name), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        apikey: transport.apiKey,
        "Content-Type": "application/json",
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload: unknown = await res.json().catch(() => null);
    if (!res.ok) return { ok: false, error: edgeFunctionError(payload) };
    return { ok: true, body: payload };
  } catch (err) {
    return { ok: false, error: (err as Error).message };
  }
}
