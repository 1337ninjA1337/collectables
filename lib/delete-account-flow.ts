/**
 * Deleting an account is three phases with three different answers to "what
 * does a failure mean", and they were one `try … finally` with none.
 *
 * ## What was wrong
 *
 * `lib/auth-context.tsx`' `deleteAccount` awaited five things in a row inside
 * `try { … } finally { setPending(false) }`. No `catch` — and none in
 * `app/settings.tsx`' `performDelete` either, which is also `try … finally`.
 * So a rejection from ANY of the five threw past both and the user got
 * nothing: the spinner stopped, no alert, no navigation. The Edge Function
 * call was fixed on 2026-10-19 by making it return an envelope; the other four
 * are the same shape, and one of them is worse than the one that was fixed.
 *
 * ## Why one `catch` would be the wrong fix
 *
 * The five steps do not mean the same thing, and a single `catch` returning
 * `{ error }` would report two of them as a lie.
 *
 *  - **Before the delete** — listing the user's images and asking Cloudinary
 *    to drop them. Best-effort by contract: an orphaned asset is not a
 *    data-loss bug, and `deleteCloudinaryImages` already treats failure as
 *    non-fatal. A failure here must NOT block the deletion, which is what a
 *    throw did: the account survived because an image listing timed out.
 *
 *  - **The delete** — the Edge Function. A failure here IS the error, and the
 *    account still exists, so "we could not delete your account" is true and
 *    retrying is the right advice.
 *
 *  - **After the delete** — clearing local storage, signing out, closing the
 *    realtime socket. The account is already irrevocably gone at this point.
 *    Reporting "deletion failed" here would be FALSE, and it is the worst of
 *    the three: the user is told to retry something that will now fail against
 *    a deleted account, while the app still looks signed in with their data on
 *    screen. A failure here is a cleanup problem, not a deletion problem.
 *
 * So the phases are separate, each failure is a value, and the answer is
 * "deleted, with these steps left undone" rather than one boolean.
 *
 * ## Why it is a module and not three `try` blocks in the provider
 *
 * The same reason `lib/edge-function-call.ts` exists: `auth-context` is a
 * provider that reaches the Supabase client, AsyncStorage, Cloudinary and the
 * realtime socket, so nothing imports it and every case about it reads its
 * source text — which is exactly the kind of case that cannot see a missing
 * `catch`. Here the five steps are parameters, so a suite can reject any one
 * of them and assert what the user is told.
 */

/** The five things deleting an account does, in the order it does them. */
export interface DeleteAccountSteps {
  /** Every Cloudinary URL this user owns, for the best-effort image sweep. */
  readonly listImageUrls: () => Promise<readonly string[]>;
  /** Ask the server to drop those assets. Best-effort. */
  readonly deleteImages: (urls: readonly string[]) => Promise<void>;
  /** The irreversible one: the Edge Function that deletes the auth user. */
  readonly deleteAccount: () => Promise<{ error?: string }>;
  /** Drop this user's rows from local storage. */
  readonly clearLocalData: () => Promise<void>;
  /** End the session and close the realtime socket. */
  readonly signOut: () => Promise<void>;
}

/**
 * A step that failed without changing whether the account was deleted.
 *
 * Carries the original `cause` as well as a printable `reason`, because the
 * caller reports these through `captureException`, which wants the thrown
 * value rather than a sentence built from it.
 */
export interface DeleteAccountWarning {
  readonly step: DeleteAccountWarningStep;
  readonly reason: string;
  readonly cause: unknown;
}

/**
 * What happened: an `error` only when the account still exists.
 *
 * `warnings` names the steps that failed without changing that answer — the
 * best-effort sweep before, and the cleanup after. They are for a log and for
 * Sentry, not for the user, whose account is gone either way.
 */
export interface DeleteAccountOutcome {
  readonly error?: string;
  readonly warnings: readonly DeleteAccountWarning[];
  /**
   * The account is gone and this device still holds its rows.
   *
   * Separated from the other warnings because it is the only one with a
   * consequence for somebody other than a log reader. `clearAllUserData`
   * removes the per-user keys AND the device-wide ones — `collectables-social-graph-v1`,
   * the language, the marketplace cache, both currency preferences — through a
   * single `AsyncStorage.multiRemove`, which is all-or-nothing: when it fails,
   * nothing is removed. The app then navigates away looking signed out while
   * the deleted account's collections, items and chat cache sit in storage, so
   * the next person to open it on this device sees them.
   *
   * It is not an `error`: the deletion succeeded, and telling somebody to retry
   * it would send them at an account that no longer exists. It is the one
   * warning the user has to be told about, which is why it is a field and not
   * a `warnings.some(...)` every caller would have to think to write.
   */
  readonly localDataRemains: boolean;
}

/** The step names a warning can carry, so a reader can grep for them. */
export const DELETE_ACCOUNT_STEPS = [
  "listImageUrls",
  "deleteImages",
  "clearLocalData",
  "signOut",
] as const;

/** A warning's step name — every step whose failure is not the answer. */
export type DeleteAccountWarningStep = (typeof DELETE_ACCOUNT_STEPS)[number];

/** `error.message` when there is one, and something printable when there is not. */
function reasonOf(err: unknown): string {
  if (err instanceof Error && err.message.length > 0) return err.message;
  if (typeof err === "string" && err.length > 0) return err;
  return "unknown error";
}

/**
 * Run `step`, and report a rejection as a warning rather than letting it out.
 *
 * Used for the four steps whose failure does not change whether the account
 * was deleted. `void` rather than a result, because nothing downstream reads
 * what a cleanup step returned.
 */
async function attempt(
  warnings: DeleteAccountWarning[],
  step: DeleteAccountWarningStep,
  run: () => Promise<unknown>,
): Promise<void> {
  try {
    await run();
  } catch (err) {
    warnings.push({ step, reason: reasonOf(err), cause: err });
  }
}

/**
 * Delete the account, and come back with what the user should be told.
 *
 * The one step whose failure is the answer is the Edge Function call, and it
 * is also the only one this function returns early from: everything after it
 * runs on an account that no longer exists, and everything before it is a
 * courtesy to Cloudinary.
 *
 * The image sweep runs even when listing the URLs failed — with an empty list,
 * so `deleteImages` is asked to delete nothing and the warning already names
 * what went wrong. That keeps the two best-effort steps independent rather
 * than making one the other's precondition.
 */
export async function runDeleteAccount(
  steps: DeleteAccountSteps,
): Promise<DeleteAccountOutcome> {
  const warnings: DeleteAccountWarning[] = [];

  let urls: readonly string[] = [];
  await attempt(warnings, "listImageUrls", async () => {
    urls = await steps.listImageUrls();
  });
  if (urls.length > 0) {
    await attempt(warnings, "deleteImages", () => steps.deleteImages(urls));
  }

  let error: string | undefined;
  try {
    error = (await steps.deleteAccount()).error;
  } catch (err) {
    // The call is supposed to return an envelope rather than throw — see
    // `lib/edge-function-call.ts`. This is the belt to that braces: a throw
    // here means the account may or may not exist, and the honest answer is
    // the one that does not clear the user's data on a maybe.
    error = reasonOf(err);
  }
  if (error !== undefined) return { error, warnings, localDataRemains: false };

  // Past this line the account is gone. Nothing below can make that untrue,
  // so nothing below can produce an `error`.
  await attempt(warnings, "clearLocalData", () => steps.clearLocalData());
  await attempt(warnings, "signOut", () => steps.signOut());

  return {
    warnings,
    localDataRemains: warnings.some((warning) => warning.step === "clearLocalData"),
  };
}
