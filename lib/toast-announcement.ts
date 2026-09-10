/**
 * What a toast says out loud, or nothing.
 *
 * A toast is the app's main "something happened" channel and it was
 * visual-only: `<ToastHost>` is an overlay at the top of the tree, so a screen
 * reader reaches it only if it happens to walk into that subtree, which by the
 * time it does may be seconds after the toast has gone. Two callers had
 * hand-written `announceMessage` calls beside their `toast.show(…)` for exactly
 * this reason; every other caller was silent.
 *
 * So the announcement is derived here, from the toast itself, and made once by
 * the provider. Pure and in its own module because `toast-context.tsx` pulls
 * React Native and cannot be imported under `tsx --test` — the sentence a
 * screen-reader user hears should not be the one rule in that file nothing can
 * check.
 *
 * The action's label is deliberately NOT part of it. "Undo" read aloud with no
 * way to say how to reach the button is a worse sentence than the message
 * alone, and the reachable version of that button is a web focus concern
 * rather than something to solve in a string.
 */

export type ToastAnnouncementInput = {
  readonly title?: string;
  readonly message: string;
};

/**
 * The sentence, or null when there is nothing worth saying.
 *
 * Both halves are trimmed, because a title is optional and a caller that
 * passes `""` means "no title" rather than "an empty one". A title already
 * ending in its own punctuation is not given a second period — "Saved." and
 * "Saved.." are the same fact and only one of them reads as written on
 * purpose.
 */
export function toastAnnouncement(input: ToastAnnouncementInput): string | null {
  const title = (input.title ?? "").trim();
  const message = (input.message ?? "").trim();
  if (!title && !message) return null;
  if (!title) return message;
  if (!message) return title;
  const separator = /[.!?:;]$/.test(title) ? " " : ". ";
  return `${title}${separator}${message}`;
}
