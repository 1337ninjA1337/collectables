import { useEffect, useRef, useState } from "react";

import { subscribeToEntryCurrency } from "@/lib/entry-currency-store";
import { getEntryCurrency } from "@/lib/locale-helpers";

/**
 * The currency a cost form should open in, kept current for as long as the
 * screen is mounted.
 *
 * Three surfaces had this as a `useState` plus a `getEntryCurrency()` effect
 * with an empty dep array — a read taken once, at mount, and never taken
 * again. A stack keeps the screen underneath mounted, so changing the
 * preference in settings and walking back left the wishlist's add sheet
 * offering the currency the user had just stopped using.
 *
 * `lib/entry-currency-store.ts` explains why the notification carries no value
 * and this re-reads instead: an empty entry slot means "follow the display
 * currency", so the effective answer depends on two keys and only
 * `getEntryCurrency` knows the rule.
 *
 * Returns `null` until the first read lands and when neither slot holds a
 * valid code — the same contract `getEntryCurrency` has, deliberately: a
 * caller that wants a currency to show anyway has a language default to fall
 * back on, and inventing one here would hide the difference between "not read
 * yet" and "nothing stored".
 */
export function useEntryCurrency(): string | null {
  const [entryCurrency, setEntryCurrency] = useState<string | null>(null);

  useEffect(() => {
    // Not a `cancelled` flag around the subscription as well: `read` is
    // registered and unregistered by this same effect, so the only in-flight
    // answer that can land after unmount is one this flag covers.
    let cancelled = false;
    const read = (): void => {
      void getEntryCurrency().then((stored) => {
        if (!cancelled) setEntryCurrency(stored);
      });
    };
    read();
    const unsubscribe = subscribeToEntryCurrency(read);
    return () => {
      cancelled = true;
      unsubscribe();
    };
  }, []);

  return entryCurrency;
}

/**
 * The same subscription for a screen that keeps the currency in its OWN state
 * — a cost form, where the value is the form's field and the stored preference
 * is only what it opens with.
 *
 * `apply` is called with each answer as it lands, including the first. A form
 * that has already been edited still receives the change, and that is right:
 * the only way the stored value moves while a form is open is that the user
 * moved it, on another screen, deliberately.
 */
export function useEntryCurrencyEffect(apply: (stored: string) => void): void {
  const entryCurrency = useEntryCurrency();
  // Through a ref, the `use-visibility-refresh` idiom: every caller passes an
  // inline arrow, so `apply` in the dep list would re-run this on every render
  // and re-apply a preference over a choice the user is in the middle of
  // making. The effect fires on the VALUE changing, which is the event.
  const applyRef = useRef(apply);
  applyRef.current = apply;
  useEffect(() => {
    if (entryCurrency !== null) applyRef.current(entryCurrency);
  }, [entryCurrency]);
}
